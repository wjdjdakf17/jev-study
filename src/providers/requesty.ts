/**
 * src/providers/requesty.ts — 진짜 Jev를 호출하는 DecisionClient
 * ────────────────────────────────────────────────────────────
 * 경로: Requesty 라우터(https://router.requesty.ai/v1)의
 *       `typesafe/jev-latest` — TypeSafe 웨이팅리스트/빌링 없이
 *       Jev를 쓸 수 있는 공식 경로다 (Requesty 무료 크레딧으로 실습).
 *
 * 요청/응답 계약 (Requesty Decisions 문서, 2026-09 기준):
 *
 *   POST /v1/chat/completions
 *   { model: "typesafe/jev-latest",
 *     messages: [{ role: "user", content: state }],          ← state
 *     response_format: { type: "questions", questions: {...} } }
 *
 *   응답: choices[0].message.content 가 JSON 문자열 —
 *   { 키: { type, choice|score|noul, confidence, probabilities, legend } }
 *
 * 제약: user 텍스트 메시지만, 스트리밍 불가(400), questions 응답 형식만.
 *
 * 이 파일의 핵심은 순수 변환 함수 두 개다 (toRequesty / fromRequesty).
 * 네트워크는 얇게 — 그래서 변환 로직은 키 없이도 테스트된다.
 */

import type { DecisionClient, DecideRequest } from "../client.js";
import type { Decision, DecisionMap, Question } from "../types.js";

const DEFAULT_BASE_URL = "https://router.requesty.ai/v1";
const DEFAULT_MODEL = "typesafe/jev-latest";

export interface RequestyOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly model?: string;
  /** 테스트 주입용 fetch. 기본은 전역 fetch. */
  readonly fetch?: typeof fetch;
}

/* ── 우리 질문 → Requesty questions 객체 ─────────────────────── */

export function toRequestyQuestions(
  questions: readonly Question[],
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};

  for (const q of questions) {
    switch (q.kind) {
      case "choice":
        // criteria는 {옵션: 언제 이 옵션인지 설명}. 우리 타입은 라벨만
        // 있으므로 라벨을 설명으로 쓴다 (라벨=설명이 되게 짓는 게 권장).
        out[q.key] = {
          type: "choice",
          instructions: q.question,
          criteria: Object.fromEntries(q.options.map((o) => [o, o])),
        };
        break;
      case "score":
        // criteria는 낮은→높은 순 라벨 배열. 우리 levels의 label을 보낸다.
        // (description은 로컬에서만 쓰고, index→label 사상은 우리가 갖고 있다)
        out[q.key] = {
          type: "score",
          instructions: q.question,
          criteria: q.levels.map((l) => l.label),
        };
        break;
      case "noul":
        // 우리 타입은 명제(proposition) 필드 — Jev의 instructions 자리로.
        out[q.key] = { type: "noul", instructions: q.proposition };
        break;
    }
  }
  return out;
}

/* ── Requesty 응답 → 우리 Decision ──────────────────────────── */

interface RawAnswer {
  type?: string;
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
  score?: number;
  legend?: Record<string, string>;
  noul?: number;
}

export function fromRequestyAnswers(
  questions: readonly Question[],
  answers: Record<string, RawAnswer>,
): DecisionMap {
  const out: Record<string, Decision> = {};

  for (const q of questions) {
    const a = answers[q.key];
    if (!a) continue;

    if (q.kind === "choice" && a.type === "choice") {
      out[q.key] = {
        kind: "choice",
        selected: a.choice ?? q.options[0] ?? "",
        probabilities: a.probabilities ?? {},
        confidence: a.confidence ?? 0,
      };
    } else if (q.kind === "score" && a.type === "score") {
      // score는 0-based index. 우리 라벨로 되돌리고 확률 키도
      // index → label로 재매핑한다.
      const idx = a.score ?? 0;
      const label = q.levels[idx]?.label ?? a.legend?.[String(idx)] ?? String(idx);
      const probabilities: Record<string, number> = {};
      for (const [k, v] of Object.entries(a.probabilities ?? {})) {
        const levelLabel = q.levels[Number(k)]?.label ?? a.legend?.[k] ?? k;
        probabilities[levelLabel] = v;
      }
      out[q.key] = {
        kind: "score",
        selected: label,
        probabilities,
        confidence: a.confidence ?? 0,
      };
    } else if (q.kind === "noul" && a.type === "noul") {
      out[q.key] = { kind: "noul", probabilityOfYes: a.noul ?? 0 };
    }
  }
  return out;
}

/* ── 클라이언트 ─────────────────────────────────────────────── */

export class RequestyDecisionClient implements DecisionClient {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly doFetch: typeof fetch;

  constructor(private readonly options: RequestyOptions) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.model = options.model ?? DEFAULT_MODEL;
    this.doFetch = options.fetch ?? fetch;
  }

  /** 공식 JS SDK 대신 fetch 한 방 — 의존성 0개를 유지하기 위해서. */
  async decide(request: DecideRequest): Promise<DecisionMap> {
    const state = serializeState(request.state);

    const res = await this.doFetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: "user", content: state }],
        response_format: {
          type: "questions",
          questions: toRequestyQuestions(request.questions),
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Requesty ${res.status}: ${body.slice(0, 300)}`);
    }

    const payload = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("Requesty: assistant 메시지가 비었음");

    return fromRequestyAnswers(request.questions, JSON.parse(content) as Record<string, RawAnswer>);
  }
}

/** 구조화 state를 하나의 텍스트로 — Jev는 user 텍스트 1통만 받는다. */
function serializeState(state: DecideRequest["state"]): string {
  if (typeof state === "string") return state;
  return Object.entries(state)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("\n");
}
