import { z } from "zod";

export const SECURITY_OBSERVATION_FAMILY_BROWSER = 1;
export const SECURITY_OBSERVATION_FAMILY_FPJS = 2;
export const SECURITY_OBSERVATION_FAMILY_THUMBMARK = 3;

export const securityPlanEntrySchema = z.tuple([
  z.string().min(8).max(64),
  z.number().int().min(1).max(3),
  z.string().min(1).max(16),
]);

export const securityEvidenceEntrySchema = z.tuple([
  z.string().min(8).max(64),
  z.string().length(64),
]);

export type SecurityPlanEntry = z.infer<typeof securityPlanEntrySchema>;
export type SecurityEvidenceEntry = z.infer<typeof securityEvidenceEntrySchema>;

export const securityObservationComponentMap = [
  {
    family: SECURITY_OBSERVATION_FAMILY_BROWSER,
    code: "a1",
    fingerprintType: "browser",
    componentName: "timezone",
    required: true,
  },
  {
    family: SECURITY_OBSERVATION_FAMILY_BROWSER,
    code: "a2",
    fingerprintType: "browser",
    componentName: "language",
    required: true,
  },
  {
    family: SECURITY_OBSERVATION_FAMILY_BROWSER,
    code: "a3",
    fingerprintType: "browser",
    componentName: "platform",
    required: true,
  },
  {
    family: SECURITY_OBSERVATION_FAMILY_BROWSER,
    code: "a4",
    fingerprintType: "browser",
    componentName: "userAgent",
    required: true,
  },
  {
    family: SECURITY_OBSERVATION_FAMILY_FPJS,
    code: "b1",
    fingerprintType: "fingerprintjs",
    componentName: "visitorId",
    required: false,
  },
  {
    family: SECURITY_OBSERVATION_FAMILY_FPJS,
    code: "b2",
    fingerprintType: "fingerprintjs",
    componentName: "canvas",
    required: false,
  },
  {
    family: SECURITY_OBSERVATION_FAMILY_FPJS,
    code: "b3",
    fingerprintType: "fingerprintjs",
    componentName: "fonts",
    required: false,
  },
  {
    family: SECURITY_OBSERVATION_FAMILY_FPJS,
    code: "b4",
    fingerprintType: "fingerprintjs",
    componentName: "screen",
    required: false,
  },
  {
    family: SECURITY_OBSERVATION_FAMILY_THUMBMARK,
    code: "c1",
    fingerprintType: "thumbmarkjs",
    componentName: "audio",
    required: false,
  },
  {
    family: SECURITY_OBSERVATION_FAMILY_THUMBMARK,
    code: "c2",
    fingerprintType: "thumbmarkjs",
    componentName: "canvas",
    required: false,
  },
  {
    family: SECURITY_OBSERVATION_FAMILY_THUMBMARK,
    code: "c3",
    fingerprintType: "thumbmarkjs",
    componentName: "webgl",
    required: false,
  },
  {
    family: SECURITY_OBSERVATION_FAMILY_THUMBMARK,
    code: "c4",
    fingerprintType: "thumbmarkjs",
    componentName: "fonts",
    required: false,
  },
] as const;
