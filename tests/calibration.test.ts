/**
 * tests/calibration.test.ts — 보정 측정 도구가 수학적으로 맞는지.
 *
 * Brier score와 신뢰도 버킷은 실제 평가에서 그대로 쓸 수 있는
 * 표준 도구라, 테스트도 "지표의 정의"를 그대로 확인한다.
 */
import { describe, expect, it } from "vitest";

import { brierScore, reliabilityBuckets } from "../src/calibration.js";

describe("brierScore", () => {
  it("확신하고 모두 맞추면 0", () => {
    const score = brierScore([
      { predicted: 1, outcome: 1 },
      { predicted: 0, outcome: 0 },
    ]);
    expect(score).toBe(0);
  });

  it("확신하고 모두 틀리면 1 — 가장 나쁜 점수", () => {
    const score = brierScore([
      { predicted: 1, outcome: 0 },
      { predicted: 0, outcome: 1 },
    ]);
    expect(score).toBe(1);
  });

  it("정보 없는 0.5 예측은 0.25", () => {
    const score = brierScore([{ predicted: 0.5, outcome: 1 }]);
    expect(score).toBeCloseTo(0.25, 10);
  });

  it("겸손하게 틀리는 게 뻔뻔하게 틀리는 것보다 낫다 — 캘리브레이션의 핵심", () => {
    const humble = brierScore([{ predicted: 0.6, outcome: 0 }]); // 0.16
    const bold = brierScore([{ predicted: 1, outcome: 0 }]); // 1.0
    expect(humble).toBeLessThan(bold);
  });

  it("빈 배열은 0으로 정의", () => {
    expect(brierScore([])).toBe(0);
  });
});

describe("reliabilityBuckets", () => {
  it("잘 보정된 예측은 gap이 0에 가깝다", () => {
    // 0.8~0.9 구간의 예측 10개 중 실제로 8개가 참 — gap ≈ 0
    const predictions = Array.from({ length: 10 }, (_, i) => ({
      predicted: 0.85,
      outcome: (i < 8 ? 1 : 0) as 0 | 1,
    }));

    const buckets = reliabilityBuckets(predictions);
    const bucket = buckets.find((b) => b.range[0] === 0.8);
    expect(bucket).toBeDefined();
    expect(bucket?.gap).toBeLessThanOrEqual(0.05);
    expect(bucket?.count).toBe(10);
  });

  it("과신된 모델은 높은 구간에서 gap이 벌어진다", () => {
    // 0.9 확신 예측 10개 중 실제로는 절반만 참 — 심한 과신.
    const predictions = Array.from({ length: 10 }, (_, i) => ({
      predicted: 0.95,
      outcome: (i < 5 ? 1 : 0) as 0 | 1,
    }));

    const buckets = reliabilityBuckets(predictions);
    const bucket = buckets.find((b) => b.range[0] === 0.9);
    expect(bucket).toBeDefined();
    expect(bucket?.gap).toBeGreaterThan(0.4);
    expect(bucket?.observedFrequency).toBeCloseTo(0.5, 5);
  });

  it("빈 구간은 버킷을 만들지 않는다", () => {
    const buckets = reliabilityBuckets([{ predicted: 0.05, outcome: 0 }]);
    // 0.0 구간 하나만 존재해야 한다.
    expect(buckets.length).toBe(1);
    expect(buckets[0]?.range[0]).toBe(0);
  });
});
