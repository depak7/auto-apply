import { describe, expect, it } from "vitest";

import { droppedFacts, inventedNumbers, inventedTerms, plainText, trivialChange } from "../src/tailoring/rules.ts";

describe("inventedNumbers", () => {
  it("allows the same figures, however they are written", () => {
    expect(
      inventedNumbers("Processed 100K+ alarms, 99.95% uptime", "99.95% uptime while processing 100K+ alarms"),
    ).toEqual([]);
    expect(inventedNumbers("Cut latency by 1,200 ms", "Reduced latency 1200ms")).toEqual([]);
  });
  it("flags new figures", () => {
    expect(inventedNumbers("Improved throughput", "Improved throughput by 30%")).toEqual(["30"]);
  });
});

describe("inventedTerms", () => {
  const resume = "Skills: Java, Spring Boot, Apache Kafka, PostgreSQL, Docker";
  it("allows technologies the resume lists anywhere", () => {
    expect(inventedTerms("Built backend services", "Built Spring Boot services on Kafka", resume)).toEqual([]);
  });
  it("flags technologies the resume never mentions", () => {
    expect(inventedTerms("Built backend services", "Built services on AWS with GraphQL", resume)).toEqual([
      "AWS",
      "GraphQL",
    ]);
  });
  it("flags named job keywords added without support, but not descriptive ones", () => {
    expect(inventedTerms("Built services", "Built services with Apache Camel", resume, ["Apache Camel"])).toEqual([
      "Apache Camel",
    ]);
    expect(
      inventedTerms("Ran Ceph clusters", "Ran large-scale storage on Ceph clusters", resume, ["large-scale storage"]),
    ).toEqual([]);
  });
});

it("plainText strips markdown", () => {
  expect(plainText("- Built **event-driven** `Kafka` services")).toBe("Built event-driven Kafka services");
});

it("droppedFacts: numbers and named tools can't disappear", () => {
  expect(droppedFacts("Cut latency 30% with Kafka and CDC pipelines", "Cut latency using pipelines")).toEqual([
    "30",
    "CDC",
  ]);
  expect(droppedFacts("Built a JAR for Kafka", "Built a Kafka library (JAR)")).toEqual([]);
});

it("droppedFacts: ownership verbs can't be weakened", () => {
  expect(droppedFacts("Architected a rule engine", "Built a rule engine")).toEqual(["architected"]);
  expect(droppedFacts("Designed and built a library", "Guaranteed ordering by designing a library")).toEqual([]);
});

it("trivialChange: punctuation or one word is not a rewrite", () => {
  expect(trivialChange("Built APIs, workflows and integrations.", "Built APIs, workflows, and integrations.")).toBe(
    true,
  );
  expect(trivialChange("Process JSON-based REST requests", "Process JSON REST requests")).toBe(true);
  expect(
    trivialChange("Designed a library adopted across services", "Guaranteed ordering across services with a library"),
  ).toBe(false);
});
