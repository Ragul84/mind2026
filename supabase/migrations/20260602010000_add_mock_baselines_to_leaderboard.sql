-- Re-define state-level XP Aggregation to include mock baseline values
DROP FUNCTION IF EXISTS get_state_leaderboard();

CREATE OR REPLACE FUNCTION get_state_leaderboard()
RETURNS TABLE (
  rank BIGINT,
  name TEXT,
  code TEXT,
  total_xp BIGINT,
  active_users BIGINT,
  badge TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH all_states (s_name, s_code, s_badge, mock_xp, mock_users) AS (
    VALUES 
      ('Maharashtra', 'MH', '🌆', 125750::BIGINT, 2847::BIGINT),
      ('Karnataka', 'KA', '💻', 118920::BIGINT, 2156::BIGINT),
      ('Tamil Nadu', 'TN', '🏺', 112430::BIGINT, 2894::BIGINT),
      ('Gujarat', 'GJ', '🧵', 98650::BIGINT, 1753::BIGINT),
      ('Delhi', 'DL', '🏛️', 89750::BIGINT, 1429::BIGINT),
      ('Uttar Pradesh', 'UP', '🕌', 88120::BIGINT, 2490::BIGINT),
      ('West Bengal', 'WB', '🐅', 76250::BIGINT, 1198::BIGINT),
      ('Rajasthan', 'RJ', '🏜️', 54000::BIGINT, 820::BIGINT),
      ('Andhra Pradesh', 'AP', '💎', 48000::BIGINT, 750::BIGINT),
      ('Telangana', 'TS', '🏗️', 45000::BIGINT, 680::BIGINT),
      ('Madhya Pradesh', 'MP', '🏰', 38000::BIGINT, 590::BIGINT),
      ('Kerala', 'KL', '🌴', 35000::BIGINT, 520::BIGINT),
      ('Punjab', 'PB', '🌾', 32000::BIGINT, 480::BIGINT),
      ('Haryana', 'HR', '🐄', 28000::BIGINT, 410::BIGINT),
      ('Bihar', 'BR', '☸️', 25000::BIGINT, 380::BIGINT),
      ('Odisha', 'OR', '🌊', 22000::BIGINT, 310::BIGINT),
      ('Assam', 'AS', '🍃', 18000::BIGINT, 250::BIGINT),
      ('Jharkhand', 'JH', '⛰️', 15000::BIGINT, 190::BIGINT),
      ('Chhattisgarh', 'CH', '🌳', 12000::BIGINT, 140::BIGINT),
      ('Himachal Pradesh', 'HP', '❄️', 9000::BIGINT, 90::BIGINT),
      ('Uttarakhand', 'UK', '🏔️', 6000::BIGINT, 60::BIGINT),
      ('Goa', 'GA', '🏖️', 3000::BIGINT, 30::BIGINT)
  ),
  state_stats AS (
    SELECT 
      state as user_state,
      SUM(COALESCE(total_xp, 0))::BIGINT as total_xp,
      COUNT(id)::BIGINT as active_users
    FROM user_profiles
    WHERE state IS NOT NULL
    GROUP BY state
  )
  SELECT 
    ROW_NUMBER() OVER (ORDER BY (ast.mock_xp + COALESCE(ss.total_xp, 0)) DESC, ast.s_name ASC) as rank,
    ast.s_name as name,
    ast.s_code as code,
    (ast.mock_xp + COALESCE(ss.total_xp, 0))::BIGINT as total_xp,
    (ast.mock_users + COALESCE(ss.active_users, 0))::BIGINT as active_users,
    ast.s_badge as badge
  FROM all_states ast
  LEFT JOIN state_stats ss ON ast.s_name = ss.user_state
  ORDER BY total_xp DESC, name ASC;
END;
$$ LANGUAGE plpgsql;
