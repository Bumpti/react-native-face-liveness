/**
 * Server helpers for AWS Rekognition Face Liveness, for Deno (Supabase edge
 * functions). Signing uses aws4fetch; there is no AWS SDK dependency.
 *
 * These helpers carry no product rules: thresholds, limits and storage belong
 * to the app that calls them.
 */
import { AwsClient } from "npm:aws4fetch@1.0.20";

export type AwsConfig = {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  sessionToken?: string;
};

/** Injectable for tests; defaults to the global fetch. */
export type Fetch = (request: Request) => Promise<Response>;

export class AwsError extends Error {
  constructor(
    /** The AWS error code, e.g. "ThrottlingException" or "AccessDenied". */
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AwsError";
  }
}

export type Challenge = "FaceMovementAndLightChallenge" | "FaceMovementChallenge";

export type LivenessStatus = "CREATED" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "EXPIRED";

export type LivenessResult = {
  status: LivenessStatus;
  /** 0–100, or null when AWS returned none. */
  confidence: number | null;
  /** The reference image AWS picked from the video, or null. */
  referenceImage: Uint8Array | null;
  /** AWS feedback codes, e.g. "LOW_LIGHTING_DETECTED". */
  feedback: string[];
};

export type TemporaryCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  /** ISO-8601. */
  expiration: string;
};

export type FaceMatch = {
  faceId: string;
  externalImageId: string | null;
  similarity: number;
};

const defaultFetch: Fetch = (request) => fetch(request);

// ---------------------------------------------------------------- liveness

export async function createLivenessSession(
  cfg: AwsConfig,
  opts: { challenge?: Challenge; clientRequestToken?: string; auditImagesLimit?: number } = {},
  f: Fetch = defaultFetch,
): Promise<string> {
  const body: Record<string, unknown> = {
    Settings: {
      AuditImagesLimit: opts.auditImagesLimit ?? 0,
      ChallengePreferences: [{ Type: opts.challenge ?? "FaceMovementAndLightChallenge" }],
    },
  };
  if (opts.clientRequestToken) body.ClientRequestToken = opts.clientRequestToken;
  const res = await rekognition<{ SessionId: string }>(cfg, "CreateFaceLivenessSession", body, f);
  return res.SessionId;
}

export async function getLivenessResult(
  cfg: AwsConfig,
  sessionId: string,
  f: Fetch = defaultFetch,
): Promise<LivenessResult> {
  const res = await rekognition<{
    Status: LivenessStatus;
    Confidence?: number;
    ReferenceImage?: { Bytes?: string };
    Feedback?: { Code?: string }[];
  }>(cfg, "GetFaceLivenessSessionResults", { SessionId: sessionId }, f);
  return {
    status: res.Status,
    confidence: typeof res.Confidence === "number" ? res.Confidence : null,
    referenceImage: res.ReferenceImage?.Bytes ? decodeBase64(res.ReferenceImage.Bytes) : null,
    feedback: (res.Feedback ?? []).map((item) => item.Code ?? "").filter(Boolean),
  };
}

export type LivenessVerdict = "approved" | "declined" | "retry" | "failed" | "pending";

/**
 * - SUCCEEDED, confidence >= min, reference image → approved
 * - SUCCEEDED, confidence < min → declined
 * - SUCCEEDED without a reference image (or without a confidence) → retry
 * - FAILED / EXPIRED → failed
 * - CREATED / IN_PROGRESS → pending
 */
export function livenessVerdict(
  result: Pick<LivenessResult, "status" | "confidence" | "referenceImage">,
  minConfidence: number,
): LivenessVerdict {
  switch (result.status) {
    case "CREATED":
    case "IN_PROGRESS":
      return "pending";
    case "SUCCEEDED":
      if (result.confidence === null) return "retry";
      if (result.confidence < minConfidence) return "declined";
      return result.referenceImage ? "approved" : "retry";
    default:
      return "failed";
  }
}

// ---------------------------------------------------------------- STS

/**
 * Temporary credentials for the device, from STS AssumeRole on a role that
 * allows only rekognition:StartFaceLivenessSession.
 */
export async function issueClientCredentials(
  cfg: AwsConfig,
  opts: { roleArn: string; sessionName: string; durationSeconds?: number },
  f: Fetch = defaultFetch,
): Promise<TemporaryCredentials> {
  const aws = client(cfg, "sts");
  const params = new URLSearchParams({
    Action: "AssumeRole",
    Version: "2011-06-15",
    RoleArn: opts.roleArn,
    RoleSessionName: opts.sessionName.replace(/[^\w+=,.@-]/g, "-").slice(0, 64),
    DurationSeconds: String(opts.durationSeconds ?? 900),
  });
  const request = await aws.sign(`https://sts.${cfg.region}.amazonaws.com/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: params.toString(),
  });
  const response = await f(request);
  const text = await response.text();
  if (!response.ok) throw stsError(text, response.status);
  const credentials = JSON.parse(text)?.AssumeRoleResponse?.AssumeRoleResult?.Credentials;
  if (!credentials?.AccessKeyId) throw new AwsError("MalformedResponse", "STS returned no credentials", response.status);
  return {
    accessKeyId: credentials.AccessKeyId,
    secretAccessKey: credentials.SecretAccessKey,
    sessionToken: credentials.SessionToken,
    expiration: toIso(credentials.Expiration),
  };
}

// ---------------------------------------------------------------- faces

/** Faces in the collection that match the largest face in the image. No face in the image → []. */
export async function searchFacesByImage(
  cfg: AwsConfig,
  opts: { collectionId: string; image: Uint8Array; threshold: number; maxFaces?: number },
  f: Fetch = defaultFetch,
): Promise<FaceMatch[]> {
  try {
    const res = await rekognition<{
      FaceMatches?: { Similarity: number; Face: { FaceId: string; ExternalImageId?: string } }[];
    }>(cfg, "SearchFacesByImage", {
      CollectionId: opts.collectionId,
      Image: { Bytes: encodeBase64(opts.image) },
      FaceMatchThreshold: opts.threshold,
      MaxFaces: opts.maxFaces ?? 10,
    }, f);
    return (res.FaceMatches ?? []).map((match) => ({
      faceId: match.Face.FaceId,
      externalImageId: match.Face.ExternalImageId ?? null,
      similarity: match.Similarity,
    }));
  } catch (error) {
    if (isNoFaceError(error)) return [];
    throw error;
  }
}

/** Indexes the largest face; returns its face id, or null when AWS kept none. */
export async function indexFace(
  cfg: AwsConfig,
  opts: { collectionId: string; image: Uint8Array; externalImageId: string },
  f: Fetch = defaultFetch,
): Promise<string | null> {
  try {
    const res = await rekognition<{ FaceRecords?: { Face?: { FaceId?: string } }[] }>(cfg, "IndexFaces", {
      CollectionId: opts.collectionId,
      Image: { Bytes: encodeBase64(opts.image) },
      ExternalImageId: opts.externalImageId,
      MaxFaces: 1,
      QualityFilter: "AUTO",
    }, f);
    return res.FaceRecords?.[0]?.Face?.FaceId ?? null;
  } catch (error) {
    if (isNoFaceError(error)) return null;
    throw error;
  }
}

export async function deleteFaces(
  cfg: AwsConfig,
  opts: { collectionId: string; faceIds: string[] },
  f: Fetch = defaultFetch,
): Promise<void> {
  for (let i = 0; i < opts.faceIds.length; i += 4096) {
    await rekognition(cfg, "DeleteFaces", {
      CollectionId: opts.collectionId,
      FaceIds: opts.faceIds.slice(i, i + 4096),
    }, f);
  }
}

// ---------------------------------------------------------------- internals

function client(cfg: AwsConfig, service: string): AwsClient {
  return new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    sessionToken: cfg.sessionToken,
    region: cfg.region,
    service,
    retries: 0,
  });
}

async function rekognition<T>(cfg: AwsConfig, target: string, body: unknown, f: Fetch): Promise<T> {
  const request = await client(cfg, "rekognition").sign(`https://rekognition.${cfg.region}.amazonaws.com/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": `RekognitionService.${target}`,
    },
    body: JSON.stringify(body),
  });
  const response = await f(request);
  const text = await response.text();
  if (!response.ok) {
    const parsed = safeJson(text) as { __type?: string; code?: string; message?: string; Message?: string } | null;
    const code = (parsed?.__type ?? parsed?.code ?? "UnknownError").split("#").pop() ?? "UnknownError";
    throw new AwsError(code, parsed?.message ?? parsed?.Message ?? text.slice(0, 300), response.status);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

function stsError(text: string, status: number): AwsError {
  const parsed = safeJson(text) as { Error?: { Code?: string; Message?: string } } | null;
  const code = parsed?.Error?.Code ?? /<Code>([^<]+)<\/Code>/.exec(text)?.[1] ?? "UnknownError";
  const message = parsed?.Error?.Message ?? /<Message>([^<]+)<\/Message>/.exec(text)?.[1] ?? text.slice(0, 300);
  return new AwsError(code, message, status);
}

function isNoFaceError(error: unknown): boolean {
  return error instanceof AwsError && error.code === "InvalidParameterException" && /face/i.test(error.message);
}

function toIso(value: unknown): string {
  if (typeof value === "number") return new Date(value * 1000).toISOString();
  return new Date(String(value)).toISOString();
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
