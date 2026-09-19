/** Shared report shape for the local file and Tiger Data. */
export function conversationSchema(dialect: "sqlite" | "postgres"): string {
  const pg = dialect === "postgres";
  const prefix = pg ? "analytics." : "";
  const field = (key: string, alias = "") => pg
    ? `${alias}properties->>'${key}'` : `json_extract(${alias}properties, '$.${key}')`;
  const number = (key: string, alias = "") => `CAST((${field(key, alias)}) AS ${pg ? "bigint" : "INTEGER"})`;
  const view = (name: string) => pg ? `CREATE OR REPLACE VIEW ${prefix}${name} AS`
    : `CREATE VIEW ${name} AS`;
  return `
    ${pg ? "" : "DROP VIEW IF EXISTS conversations; DROP VIEW IF EXISTS stuttering_utterances;"}
    ${view("stuttering_utterances")}
    SELECT session_id, ${field("utteranceId")} AS utterance_id,
      occurred_at AS analyzed_at, ${number("revision")} AS revision,
      ${number("prolongation")} AS prolongation_count,
      ${number("block")} AS block_count,
      ${number("soundRepetition")} AS sound_repetition_count,
      ${number("wordRepetition")} AS word_repetition_count,
      ${number("interjection")} AS interjection_count,
      ${number("noStutteredWords")} AS no_stuttered_words_count
    FROM (
      SELECT e.*, row_number() OVER (
        PARTITION BY session_id, ${field("utteranceId", "e.")}
        ORDER BY ${number("revision", "e.")} DESC, ingestion_order DESC
      ) AS position
      FROM ${prefix}events e WHERE event_type = 'stuttering_assessment'
        AND EXISTS (SELECT 1 FROM ${prefix}events u
          WHERE u.session_id = e.session_id AND u.event_type = 'user_utterance'
            AND ${field("utteranceId", "u.")} = ${field("utteranceId", "e.")})
    ) ranked WHERE position = 1;

    ${view("conversations")}
    SELECT s.session_id, p.name,
      ${pg ? "(s.started_at AT TIME ZONE 'UTC')::date" : "date(s.started_at)"} AS conversation_date,
      s.started_at, s.ended_at, d.conversation_length_ms,
      s.user_utterances, COALESCE(a.analyzed_utterances, 0) AS analyzed_utterances,
      CASE WHEN COALESCE(a.analyzed_utterances, 0) = 0 THEN 'not_analyzed'
        WHEN a.analyzed_utterances < s.user_utterances THEN 'partial'
        ELSE 'complete' END AS analysis_status,
      a.prolongation_count, a.block_count, a.sound_repetition_count,
      a.word_repetition_count, a.no_stuttered_words_count, a.interjection_count
    FROM ${prefix}sessions s
    LEFT JOIN (
      SELECT session_id, ${field("name")} AS name FROM (
        SELECT *, row_number() OVER (PARTITION BY session_id ORDER BY ingestion_order DESC) AS position
        FROM ${prefix}events WHERE event_type = 'conversation_profile'
      ) profiles WHERE position = 1
    ) p ON p.session_id = s.session_id
    LEFT JOIN (
      SELECT session_id, max(${number("conversationDurationMs")}) AS conversation_length_ms
      FROM ${prefix}events WHERE event_type = 'session_ended' GROUP BY session_id
    ) d ON d.session_id = s.session_id
    LEFT JOIN (
      SELECT session_id, count(*) AS analyzed_utterances,
        sum(prolongation_count) AS prolongation_count, sum(block_count) AS block_count,
        sum(sound_repetition_count) AS sound_repetition_count,
        sum(word_repetition_count) AS word_repetition_count,
        sum(no_stuttered_words_count) AS no_stuttered_words_count,
        sum(interjection_count) AS interjection_count
      FROM ${prefix}stuttering_utterances GROUP BY session_id
    ) a ON a.session_id = s.session_id;
  `;
}
