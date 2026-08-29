# MindGains App Blueprint

## Product Spine

MindGains is for Indian students who need one app to:

- get a daily study mission
- learn with an AI tutor in regional languages
- practice by subject and topic
- take quick random quiz sprints
- compete for their state through knowledge

## Core Tabs

- `Home`: command center for daily study
- `Learn`: source-to-study tools, including Generate Lesson / Blueprint
- `MIGA`: one tutor experience, no visible mode switching
- `Leaderboard`: state performance and rank tracking
- `Profile`: only working destinations

## Home Must Show

- Today’s Mission
- Quiz Hub
- Quick Sprint
- State rank snapshot
- Daily Thirukkural with language meaning chips
- Study path / lesson breakdown
- MindClash entry

## Learn Must Keep

- Generate Lesson / Blueprint
  Enter any topic and produce a lesson path / topic breakdown
- Smart Text
- Smart Explain
- YouTube Brain
- PDF Intelligence
- Smart Vision

## MIGA Rules

- Present as `Talk to MIGA`
- No visible tutor/story mode split
- Teach in simple exam-focused language
- Speak in selected regional language
- Ask one short follow-up question after explanation

## Quiz Rules

Primary flow:

1. Subject selection
2. Topic selection
3. Quiz instructions
4. Quiz attempt
5. Results

Secondary flow:

- `Quick Sprint`: 10 to 20 random questions

Both flows should later feed weak-area tracking and mission updates.

## MindClash Rules

- Keep as a major differentiator
- Tie battles to real academic question banks
- Tie rewards and rank to state leaderboard
- Frame as healthy state-vs-state academic competition

## Cleanup Rules

- Do not redesign the UI system
- Hide or remove incomplete features
- Remove dead profile routes
- Reduce duplicate entry points
- Keep visuals, simplify product surface

## Immediate Build Order

1. Tighten home around mission, quiz, state, Thirukkural, and MindClash
2. Keep Generate Lesson / Blueprint prominent in Learn
3. Keep MIGA tutor-only in the visible UI
4. Build strong quiz flow from subject -> topic -> attempt -> result
5. Improve state leaderboard integration with Home and MindClash
