import { describe, expect, test } from "bun:test";
import { decileShares, gini, pearson, topShare } from "./stats";

describe("pearson", () => {
  test("perfect linear relationships hit ±1", () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 12);
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 12);
  });

  test("a known hand-computed value", () => {
    // x=[1,2,3,4,5], y=[2,1,4,3,5]: deviations dx=[-2,-1,0,1,2],
    // dy=[-1,-2,1,0,2] → Σdxdy=8, Σdx²=Σdy²=10 → r = 8/√100 = 0.8
    expect(pearson([1, 2, 3, 4, 5], [2, 1, 4, 3, 5])).toBeCloseTo(0.8, 12);
  });

  test("a constant column is null, not zero", () => {
    // Zero says "no relationship"; null says "this question has no answer
    // here". A constant column must produce the second.
    expect(pearson([1, 1, 1, 1], [1, 2, 3, 4])).toBeNull();
  });

  test("non-finite pairs are dropped, not poisoned", () => {
    expect(pearson([1, 2, Number.NaN, 3, 4], [2, 4, 5, 6, 8])).toBeCloseTo(1, 12);
  });

  test("fewer than 3 usable pairs is no evidence", () => {
    expect(pearson([1, 2], [2, 4])).toBeNull();
  });
});

describe("gini", () => {
  test("perfect equality is 0", () => {
    expect(gini([5, 5, 5, 5])).toBeCloseTo(0, 12);
  });

  test("total concentration approaches (n-1)/n", () => {
    // [0,0,0,10]: G = 2·(4·10)/(4·10) − 5/4 = 0.75
    expect(gini([0, 0, 0, 10])).toBeCloseTo(0.75, 12);
  });

  test("order does not matter", () => {
    expect(gini([3, 1, 2])).toBeCloseTo(gini([1, 2, 3]) ?? Number.NaN, 12);
  });

  test("all-zero is 0, negatives are rejected", () => {
    expect(gini([0, 0, 0])).toBe(0);
    expect(gini([1, -2, 3])).toBeNull();
  });
});

describe("topShare", () => {
  test("the top holds what it holds", () => {
    // Top 10% of ten values = the single largest.
    expect(topShare([1, 1, 1, 1, 1, 1, 1, 1, 1, 91], 0.1)).toBeCloseTo(0.91, 12);
    expect(topShare([1, 1, 1, 1, 1, 1, 1, 1, 1, 91], 0.5)).toBeCloseTo(0.95, 12);
  });

  test("a tiny fraction still takes at least one value", () => {
    // ceil, not round: "top 5%" of 10 policies is the largest one, never an
    // empty set that reports 0% concentration.
    expect(topShare([9, 1], 0.05)).toBeCloseTo(0.9, 12);
  });

  test("uniform data concentrates only as much as arithmetic demands", () => {
    expect(topShare([2, 2, 2, 2], 0.5)).toBeCloseTo(0.5, 12);
  });
});

describe("decileShares", () => {
  test("shares sum to 1 and come largest-first", () => {
    const shares = decileShares(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(shares).toHaveLength(10);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    const sorted = [...shares].sort((a, b) => b - a);
    expect(shares).toEqual(sorted);
  });

  test("fewer values than deciles degrades to per-value buckets", () => {
    expect(decileShares([6, 4])).toEqual([0.6, 0.4]);
  });
});
