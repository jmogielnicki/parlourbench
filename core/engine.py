# core/engine.py
import os
import time
import logging

from core.config import ConfigLoader
from core.state import GameState
from handlers.base import PhaseController
from handlers.registry import HandlerRegistry
from utils.chat_logger import get_chat_logger
from utils.game_session import GameSession

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("GameEngine")

class GameEngine:
    """
    Manages the game flow and coordinates components.

    The game engine is responsible for initializing the game,
    running the game loop, managing phase transitions, and
    coordinating interactions between components.
    """

    def __init__(self, config_path, llm_client_class=None):
        """
        Initialize the game engine.

        Args:
            config_path (str): Path to the game configuration file
            llm_client_class (class, optional): Class to use for LLM interaction
        """
        logger.info(f"Initializing game from config: {config_path}")
        self.config = ConfigLoader.load(config_path)

        # Create a game session for unified logging
        self.game_session = GameSession(self.config)

        # Initialize state with the game session
        self.state = GameState(self.config, self.game_session)
        self.phase_controller = PhaseController()

        # Get chat logger with the game session
        self.chat_logger = get_chat_logger(game_session=self.game_session)

        # Extract key info for logging
        self.game_name = self.config['game']['name']
        self.player_count = len(self.state.players)

        logger.info(f"Initialized {self.game_name} with {self.player_count} players")

    def run_game(self):
        """
        Run the game from start to finish.

        Executes the main game loop, processing phases until
        the game is complete. Saves state snapshots after each
        phase for analysis.
        """
        logger.info(f"Starting game: {self.game_name}")

        # Log the start of the game
        logger.info(f"Chat history will be logged to: {self.chat_logger.get_consolidated_log_path()}")
        logger.info(f"Snapshots will be logged to: {self.game_session.snapshots_path}")

        # Save initial state snapshot
        self.state.save_snapshot(is_initial=True)

        # Log a game start event
        self.game_session.save_event(
            "game_start",
            {
                "game_name": self.game_name,
                "player_count": self.player_count,
                "config_summary": {
                    "phases": [p['id'] for p in self.config['phases']],
                    "rounds": self.config.get('rounds', {}).get('count', 'dynamic')
                }
            }
        )

        # Main game loop
        while not self.state.is_game_over():
            current_phase = self.state.current_phase
            phase_config = self._get_phase_config(current_phase)
            phase_type = phase_config['type']

            logger.info(f"Processing phase: {current_phase} (type: {phase_type})")

            # Log phase start event
            self.game_session.save_event(
                "phase_start",
                {
                    "phase_id": current_phase,
                    "phase_type": phase_type,
                    "round": self.state.shared_state.get('current_round', 0)
                },
                phase_id=current_phase,
                round_num=self.state.shared_state.get('current_round', 0)
            )

            # Process the phase based on its type
            phase_result = False
            if phase_type == 'automatic':
                phase_result = self._process_automatic_phase(phase_config)
            elif phase_type == 'simultaneous_action':
                phase_result = self._process_simultaneous_phase(phase_config)
            elif phase_type == 'sequential_action':
                phase_result = self._process_sequential_phase(phase_config)
            elif phase_type == 'single_player_action':
                logger.error("single_player_action phase type not yet implemented")
                raise NotImplementedError(f"Phase type '{phase_type}' is not implemented")
            elif phase_type == 'sequential_communication':
                logger.error("sequential_communication phase type not yet implemented")
                raise NotImplementedError(f"Phase type '{phase_type}' is not implemented")
            else:
                logger.error(f"Unknown phase type: {phase_type}")
                raise ValueError(f"Unknown phase type: {phase_type}")

            # Log phase end event
            self.game_session.save_event(
                "phase_end",
                {
                    "phase_id": current_phase,
                    "phase_type": phase_type,
                    "result": phase_result,
                    "round": self.state.shared_state.get('current_round', 0)
                },
                phase_id=current_phase,
                round_num=self.state.shared_state.get('current_round', 0)
            )

            # Determine next phase
            next_phase = self.phase_controller.get_next_phase(
                self.state, current_phase, phase_result
            )

            # Save state snapshot after each phase
            logger.info(f"Saving snapshot after phase: {current_phase}")
            self.state.save_snapshot()

            logger.info(f"Transitioning from {current_phase} to {next_phase}")

            if next_phase == "game_end":
                logger.info("Game end condition met")
                self.state.game_over = True

                # Log game end event
                self.game_session.save_event(
                    "game_end",
                    {
                        "winner": self.state.get_winner()['id'] if self.state.get_winner() else None,
                        "rounds_played": self.state.shared_state.get('current_round', 0)
                    }
                )
            else:
                self.state.current_phase = next_phase

        logger.info(f"Game completed: {self.game_name}")

        # Save final results
        results_file = self.state.save_results()
        logger.info(f"Game results saved to: {results_file}")

    def _process_automatic_phase(self, phase_config):
        """
        Process an automatic phase that doesn't require player input.

        Args:
            phase_config (dict): The phase configuration

        Returns:
            bool: Result of the phase processing
        """
        handler_name = phase_config.get('handler')
        if not handler_name:
            raise ValueError(f"No handler specified for automatic phase: {phase_config['id']}")

        handler = HandlerRegistry.get_handler(handler_name)

        # Log the handler being used
        self.game_session.save_event(
            "handler_execution",
            {
                "handler": handler_name,
                "phase_id": phase_config['id']
            },
            phase_id=phase_config['id'],
            round_num=self.state.shared_state.get('current_round', 0)
        )

        return handler.process(self.state)

    def _process_simultaneous_phase(self, phase_config):
        """
        Process a phase where all players act simultaneously.

        Args:
            phase_config (dict): The phase configuration

        Returns:
            bool: True if successful
        """
        active_players = self.state.get_active_players()
        logger.info(f"Processing simultaneous actions for {len(active_players)} players")

        # Get the handler for individual player actions
        handler_name = phase_config.get('handler')
        if handler_name:
            handler = HandlerRegistry.get_handler(handler_name)
        else:
            handler = HandlerRegistry.get_handler('player_action_handler')

        # Process actions for all players
        responses = {}
        for player in active_players:
            player_id = player['id']
            logger.info(f"Getting action for player: {player_id}")

            # Log player action start
            action_id = self.game_session.save_event(
                "player_action_start",
                {
                    "player_id": player_id,
                    "phase_id": phase_config['id']
                },
                phase_id=phase_config['id'],
                round_num=self.state.shared_state.get('current_round', 0)
            )

            # Process this player's action
            action = handler.process_player(self.state, player)
            responses[player_id] = action

            # Log player action completion
            self.game_session.save_event(
                "player_action_complete",
                {
                    "player_id": player_id,
                    "action": action,
                    "action_id": action_id
                },
                phase_id=phase_config['id'],
                round_num=self.state.shared_state.get('current_round', 0)
            )

        # Store all responses in the game state
        self.state.set_action_responses(responses)

        return True

    def _process_sequential_phase(self, phase_config):
        """
        Process a phase where players take turns in sequence.

        This method processes all players in sequence for a complete phase.

        Args:
            phase_config (dict): The phase configuration

        Returns:
            bool: True if successful
        """
        # Get the handler for individual player actions
        handler_name = phase_config.get('handler')
        if handler_name:
            handler = HandlerRegistry.get_handler(handler_name)
        else:
            handler = HandlerRegistry.get_handler('player_action_handler')

        # Get active players
        active_players = self.state.get_active_players()
        if not active_players:
            logger.warning("No active players found, skipping phase")
            return True

        # Initialize phase-specific responses
        responses = {}

        # Process each player in sequence
        for i, player in enumerate(active_players):
            player_id = player['id']
            logger.info(f"Processing action for player {i+1}/{len(active_players)}: {player_id}")

            # Log player action start
            action_id = self.game_session.save_event(
                "player_action_start",
                {
                    "player_id": player_id,
                    "phase_id": phase_config['id'],
                    "turn_index": i
                },
                phase_id=phase_config['id'],
                round_num=self.state.shared_state.get('current_round', 0)
            )

            # Process this player's action
            action = handler.process_player(self.state, player)

            # Store the response
            responses[player_id] = action

            # Log player action completion
            self.game_session.save_event(
                "player_action_complete",
                {
                    "player_id": player_id,
                    "action": action,
                    "action_id": action_id,
                    "turn_index": i
                },
                phase_id=phase_config['id'],
                round_num=self.state.shared_state.get('current_round', 0)
            )

            # Save the current player index in case we need to resume
            self.state.shared_state['current_player_index'] = i

            # Optional: Save a snapshot after each player's action
            if phase_config.get('snapshot_per_action', False):
                self.state.save_snapshot()

        # Reset the player index for the next phase
        self.state.shared_state['current_player_index'] = 0

        # Store all responses in the game state
        self.state.set_action_responses(responses)

        # Indicate successful completion of the entire sequential phase
        return True


    def _get_phase_config(self, phase_id):
        """
        Get the configuration for a specific phase.

        Args:
            phase_id (str): The phase ID to find

        Returns:
            dict: The phase configuration

        Raises:
            ValueError: If the phase configuration is not found
        """
        for phase in self.config['phases']:
            if phase['id'] == phase_id:
                return phase
        raise ValueError(f"Phase configuration not found: {phase_id}")