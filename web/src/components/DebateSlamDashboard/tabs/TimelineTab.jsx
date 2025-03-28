import React, { useState, useEffect } from "react";
import { useGameData } from "../../../context/GameDataContext";
import DebateRound from "../components/DebateRound";
import { Calendar, Plus, Trophy, Users } from "lucide-react";
import DebateSessionHeader from "../components/DebateSessionHeader";
import { createDebateConfig } from "../../../utils/debateConfigUtils";
import { useParams, useNavigate, useLocation } from "react-router-dom";

/**
 * Timeline tab for displaying debate slam sessions
 */
const TimelineTab = () => {
	const { gameSessions, loadGameDetail } = useGameData();
	const [gameDetail, setGameDetail] = useState(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState(null);
	const [expandedRound, setExpandedRound] = useState(null);

	// Get sessionId from URL params
	const { sessionId } = useParams();
	const navigate = useNavigate();
	const location = useLocation();

	// Handle session initialization and URL updates
	useEffect(() => {
		if (!gameSessions || gameSessions.length === 0) {
			return; // Wait for sessions to load
		}

		// If we're on the base timeline path without a session ID
		if (location.pathname === "/games/debate-slam/timeline") {
			// Navigate to the first session
			navigate(`/games/debate-slam/timeline/${gameSessions[0].id}`, {
				replace: true,
			});
			return;
		}

		// If we have a session ID in the URL
		if (sessionId) {
			// Check if it's a valid session ID
			const isValidSession = gameSessions.some(
				(session) => session.id === sessionId
			);

			if (isValidSession) {
				// Load this session
				loadSessionDetails(sessionId);
			} else {
				// Invalid session ID - redirect to first session with error message
				setError(
					`Invalid session ID: ${sessionId}. Redirecting to a valid session.`
				);
				navigate(`/games/debate-slam/timeline/${gameSessions[0].id}`, {
					replace: true,
				});
			}
		}
	}, [gameSessions, sessionId, navigate, location.pathname]);

	// Function to load session details
	const loadSessionDetails = async (id) => {
		if (!id) return;

		setLoading(true);
		setError(null);

		try {
			const detail = await loadGameDetail(id);
			setGameDetail(detail);
		} catch (err) {
			console.error("Error loading game detail:", err);
			setError("Failed to load game details. Please try again.");
		} finally {
			setLoading(false);
		}
	};

	// Handle session selection change
	const handleSessionChange = (newSessionId) => {
		navigate(`/games/debate-slam/timeline/${newSessionId}`);
	};

	// Get session date from session ID
	const getSessionDate = (sessionId) => {
		if (!sessionId) return "";

		try {
			const match = sessionId.match(
				/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/
			);
			if (match) {
				const [_, year, month, day, hour, minute] = match;
				return `${month}/${day}/${year} ${hour}:${minute}`;
			}
		} catch (e) {
			console.error("Error parsing session date:", e);
		}

		return "";
	};

	// Handle round expansion/collapse
	const toggleRound = (roundKey) => {
		if (expandedRound === roundKey) {
			setExpandedRound(null);
		} else {
			setExpandedRound(roundKey);
		}
	};

	// Find debater info by player ID
	const getDebaterInfo = (playerId) => {
		if (!gameDetail?.debate_data?.players?.debaters) return null;

		return gameDetail.debate_data.players.debaters.find(
			(debater) => debater.player_id === playerId
		);
	};

	// Get debater model name
	const getDebaterName = (playerId) => {
		const debater = getDebaterInfo(playerId);
		return debater ? debater.model : playerId;
	};

	// Extract debate data for rendering
	const getDebateData = () => {
		if (!gameDetail) return null;

		const data = {
			topic: gameDetail.metadata.topic,
			debaters: gameDetail.players.debaters,
			judges: gameDetail.players.judges,
			preSwapRounds: gameDetail.pre_swap.rounds || [],
			postSwapRounds: gameDetail.post_swap.rounds || [],
			summary: gameDetail.summary,
		};

		// Create the debate configuration
		data.config = createDebateConfig(data);

		return data;
	};

	const debateData = getDebateData();

	return (
		<div className="w-full mx-auto">
			<div className="mb-8 mt-4">
				<h2 className="text-xl font-bold text-center mb-1">
					Debate slam matches
				</h2>
				<p className="text-sm text-center text-gray-600 mb-6">
					View debate rounds, arguments, and judge decisions
				</p>

				{/* Session selector - updated to use URL params */}
				<div className="mb-6">
					<label
						htmlFor="session-select"
						className="block text-sm font-medium text-gray-700 mb-1"
					>
						Select Debate Session:
					</label>
					<select
						id="session-select"
						className="w-full border border-gray-300 rounded-md p-2"
						value={sessionId || ""}
						onChange={(e) => handleSessionChange(e.target.value)}
					>
						{gameSessions?.map((session) => (
							<option key={session.id} value={session.id}>
								{`${session["participants"][0]} vs ${session["participants"][1]}`}
							</option>
						))}
					</select>
				</div>

				{error && <p className="text-center text-red-500">{error}</p>}

				{loading ? (
					<div className="flex items-center justify-center p-12">
						<div className="text-center">
							<div
								className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]"
								role="status"
							>
								<span className="!absolute !-m-px !h-px !w-px !overflow-hidden !whitespace-nowrap !border-0 !p-0 ![clip:rect(0,0,0,0)]">
									Loading...
								</span>
							</div>
							<p className="mt-2 text-gray-600">
								Loading debate details...
							</p>
						</div>
					</div>
				) : (
					debateData && (
						<div className="space-y-6">
							{/* Use the new enhanced debate header component */}
							<DebateSessionHeader
								debateData={debateData}
								selectedSession={sessionId}
								getSessionDate={getSessionDate}
							/>

							{/* Debate rounds */}
							<div className="bg-white rounded-lg shadow-md">
								<div className="px-6 py-4 border-b border-gray-200">
									<h3 className="text-lg font-semibold">
										Debate Rounds
									</h3>
									<h1 className="text-sm text-stone-500">
										How many votes did each model receive
										after each round
									</h1>
								</div>

								{/* Debater header */}
								<div
									className={
										(expandedRound?.includes("pre")
											? "sticky top-0 "
											: "") +
										"z-20 bg-white flex flex-row border-b border-gray-200"
									}
								>
									{" "}
									{debateData.debaters.map((debater) => {
										const color =
											debateData.config.getDebaterColor(
												debater.player_id
											);
										const side =
											debater.pre_swap_side || "TBD";
										const colorClass =
											debateData.config.getColorClass(
												color
											);

										return (
											<div
												key={debater.player_id}
												className={`flex-1/2 pb-2 pt-4 text-center`}
											>
												<div
													className={`font-medium ${colorClass}`}
												>
													{debater.model}
												</div>
												<div
													className={`text-sm ${colorClass}`}
												>
													{side.replace(/-/g, " ")}
												</div>
											</div>
										);
									})}
								</div>

								{/* Pre-swap rounds */}
								{debateData.preSwapRounds.map(
									(round, index) => {
										const processedRound = {
											...round,
											previousRoundVotes:
												index > 0
													? Object.fromEntries(
															debateData.preSwapRounds[
																index - 1
															].judge_votes.map(
																(vote) => [
																	vote.player_id,
																	vote.vote,
																]
															)
													  )
													: {},
										};
										return (
											<DebateRound
												key={`pre_${index}`}
												roundId={`pre_${index}`}
												round={processedRound}
												debaters={debateData.debaters}
												judges={debateData.judges}
												isExpanded={
													expandedRound ===
													`pre_${index}`
												}
												onToggle={() =>
													toggleRound(`pre_${index}`)
												}
												isPostSwap={false}
												config={debateData.config}
											/>
										);
									}
								)}

								{/* Side swap indicator */}
								<div className="pt-3 flex items-center justify-center">
									<div className="h-px bg-stone-300 w-full m-4"></div>
									<span className="px-3 font-semibold text-center text-stone-600">
										Side Swap
									</span>
									<div className="h-px bg-stone-300 w-full m-4"></div>
								</div>

								{/* Debater header post-swap */}
								<div className="sticky top-0 z-21 bg-white flex flex-row border-b border-gray-200 pt-2">
									{debateData.debaters.map(
										(debater, index) => {
											const side =
												debater.post_swap_side || "TBD";
											const colorClass =
												index === 0
													? "purple-600"
													: "amber-600";
											return (
												<div
													key={debater.player_id}
													className={`flex-1/2 px-4 py-2 text-center`}
												>
													<div
														className={`font-medium text-${colorClass}`}
													>
														{debater.model}
													</div>
													<div
														className={`text-sm text-${colorClass}`}
													>
														{side.replace(
															/-/g,
															" "
														)}
													</div>
												</div>
											);
										}
									)}
								</div>

								{/* Post-swap rounds */}
								{debateData.postSwapRounds.map(
									(round, index) => {
										const processedRound = {
											...round,
											previousRoundVotes:
												index > 0
													? Object.fromEntries(
															debateData.postSwapRounds[
																index - 1
															].judge_votes.map(
																(vote) => [
																	vote.player_id,
																	vote.vote,
																]
															)
													  )
													: {},
										};
										return (
											<DebateRound
												key={`post_${index}`}
												roundId={`post_${index}`}
												round={processedRound}
												debaters={debateData.debaters}
												judges={debateData.judges}
												isExpanded={
													expandedRound ===
													`post_${index}`
												}
												onToggle={() =>
													toggleRound(`post_${index}`)
												}
												isPostSwap={true}
												config={debateData.config}
											/>
										);
									}
								)}
							</div>

							{/* Winner info */}
							{debateData.summary &&
								debateData.summary.winner && (
									<div className="bg-amber-50 p-4 border border-amber-200 rounded-lg text-center">
										<h3 className="font-semibold text-lg flex items-center justify-center">
											Overall Winner:{" "}
											{getDebaterName(
												debateData.summary.winner
													.model_name
											)}
											<Trophy
												size={18}
												className="ml-2 text-amber-500 fill-amber-500"
											/>
										</h3>
										<p className="text-sm mb-2">
											Total Score:{" "}
											{
												debateData.summary.winner
													.total_score
											}
										</p>
										<p className="text-xs text-stone-500">
											* Total score is calculated by
											taking the final score before and
											after swap
										</p>
									</div>
								)}
						</div>
					)
				)}
			</div>
		</div>
	);
};

export default TimelineTab;
