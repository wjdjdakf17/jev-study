/**
 * tests/types.test.ts — 타입/유틸 계산이 의도대로 도는지.
 */
import { describe, expect, it } from "vitest";

import {
  confidenceFromDistribution,
  normalize,
} from "../src/types.js";

describe("confidenceFromDistribution", () => {
  it("분포가 한쪽에 몰리면 confidence가 높다", () => {
    const confidence = confidenceFromDistribution({
      billing: 0.92,
      technical: 0.05,
      account: 0.03,
    });
    // 1위(0.92) - 2위(0.05) = 0.87
    expect(confidence).toBeCloseTo(0.87, 5);
  });

  it("두 옵션이 비등하면 confidence가 0에 가깝다", () => {
    const confidence = confidenceFromDistribution({
      billing: 0.51,
      technical: 0.49,
    });
    expect(confidence).toBeCloseTo(0.02, 5);
  });

  it("선택지가 하나뿐이면 2위가 없어 confidence = 확률 자체", () => {
    expect(confidenceFromDistribution({ only: 1 })).toBeCloseTo(1, 5);
  });

  it("빈 분포는 0으로 처리", () => {
    expect(confidenceFromDistribution({})).toBe(0);
  });
});

describe("normalize", () => {
  it("합이 1이 되게 정규화한다", () => {
    const dist = normalize([3, 1]);
    const values = Object.values(dist);
    const sum = values.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(values[0]).toBeCloseTo(0.75, 5);
    expect(values[1]).toBeCloseTo(0.25, 5);
  });

  it("전부 0이어도 폭발하지 않고 균등 분포를 낸다", () => {
    const dist = normalize([0, 0, 0]);
    const values = Object.values(dist);
    const sum = values.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
    values.forEach((v) => expect(v).toBeCloseTo(1 / 3, 5));
  });

  it("음수 점수는 0으로 잘라낸다", () => {
    const dist = normalize([-5, 5]);
    const values = Object.values(dist);
    expect(values[0]).toBe(0);
    expect(values[1]).toBeCloseTo(1, 5);
  });
});
