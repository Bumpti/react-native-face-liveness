import { assertEquals, assertRejects } from "jsr:@std/assert@1";

import {
  AwsError,
  createLivenessSession,
  decodeBase64,
  deleteFaces,
  encodeBase64,
  type Fetch,
  getLivenessResult,
  indexFace,
  issueClientCredentials,
  livenessVerdict,
  searchFacesByImage,
} from "./mod.ts";

const cfg = { accessKeyId: "AKIATEST", secretAccessKey: "secret", region: "us-east-1" };

type Captured = { url: string; target: string | null; auth: string | null; body: string };

function fakeFetch(status: number, response: unknown, seen: Captured[] = []): Fetch {
  return async (request) => {
    seen.push({
      url: request.url,
      target: request.headers.get("x-amz-target"),
      auth: request.headers.get("authorization"),
      body: await request.text(),
    });
    const body = typeof response === "string" ? response : JSON.stringify(response);
    return new Response(body, { status });
  };
}

Deno.test("createLivenessSession signs a Rekognition call with the challenge preference", async () => {
  const seen: Captured[] = [];
  const id = await createLivenessSession(cfg, {}, fakeFetch(200, { SessionId: "s-1" }, seen));
  assertEquals(id, "s-1");
  assertEquals(seen[0].url, "https://rekognition.us-east-1.amazonaws.com/");
  assertEquals(seen[0].target, "RekognitionService.CreateFaceLivenessSession");
  assertEquals(seen[0].auth?.startsWith("AWS4-HMAC-SHA256 Credential=AKIATEST/"), true);
  assertEquals(JSON.parse(seen[0].body), {
    Settings: { AuditImagesLimit: 0, ChallengePreferences: [{ Type: "FaceMovementAndLightChallenge" }] },
  });
});

Deno.test("getLivenessResult decodes the reference image and the feedback codes", async () => {
  const image = new Uint8Array([1, 2, 3, 250]);
  const result = await getLivenessResult(cfg, "s-1", fakeFetch(200, {
    Status: "SUCCEEDED",
    Confidence: 91.5,
    ReferenceImage: { Bytes: encodeBase64(image) },
    Feedback: [{ Code: "LOW_LIGHTING_DETECTED", Message: "..." }],
  }));
  assertEquals(result.status, "SUCCEEDED");
  assertEquals(result.confidence, 91.5);
  assertEquals(Array.from(result.referenceImage ?? []), [1, 2, 3, 250]);
  assertEquals(result.feedback, ["LOW_LIGHTING_DETECTED"]);
});

Deno.test("a Rekognition error becomes an AwsError with the short code", async () => {
  const error = await assertRejects(
    () => getLivenessResult(cfg, "missing", fakeFetch(400, {
      __type: "com.amazonaws.rekognition#SessionNotFoundException",
      Message: "not found",
    })),
    AwsError,
  );
  assertEquals(error.code, "SessionNotFoundException");
  assertEquals(error.status, 400);
});

Deno.test("issueClientCredentials reads the STS JSON response", async () => {
  const seen: Captured[] = [];
  const creds = await issueClientCredentials(cfg, { roleArn: "arn:aws:iam::1:role/r", sessionName: "user id/1" }, fakeFetch(200, {
    AssumeRoleResponse: {
      AssumeRoleResult: {
        Credentials: { AccessKeyId: "ASIA1", SecretAccessKey: "s", SessionToken: "t", Expiration: 1795400000 },
      },
    },
  }, seen));
  assertEquals(creds, {
    accessKeyId: "ASIA1",
    secretAccessKey: "s",
    sessionToken: "t",
    expiration: new Date(1795400000 * 1000).toISOString(),
  });
  assertEquals(seen[0].url, "https://sts.us-east-1.amazonaws.com/");
  const params = new URLSearchParams(seen[0].body);
  assertEquals(params.get("Action"), "AssumeRole");
  assertEquals(params.get("DurationSeconds"), "900");
  assertEquals(params.get("RoleSessionName"), "user-id-1");
});

Deno.test("an STS XML error keeps its code", async () => {
  const error = await assertRejects(
    () => issueClientCredentials(cfg, { roleArn: "r", sessionName: "u" }, fakeFetch(403,
      "<ErrorResponse><Error><Code>AccessDenied</Code><Message>no</Message></Error></ErrorResponse>")),
    AwsError,
  );
  assertEquals(error.code, "AccessDenied");
});

Deno.test("searchFacesByImage maps matches, and an image without a face is no match", async () => {
  const matches = await searchFacesByImage(cfg, { collectionId: "c", image: new Uint8Array([9]), threshold: 90 },
    fakeFetch(200, { FaceMatches: [{ Similarity: 99.1, Face: { FaceId: "f1", ExternalImageId: "user-1" } }] }));
  assertEquals(matches, [{ faceId: "f1", externalImageId: "user-1", similarity: 99.1 }]);

  const none = await searchFacesByImage(cfg, { collectionId: "c", image: new Uint8Array([9]), threshold: 90 },
    fakeFetch(400, { __type: "InvalidParameterException", Message: "There are no faces in the image. Should be at least 1." }));
  assertEquals(none, []);
});

Deno.test("indexFace returns the face id, or null when nothing was indexed", async () => {
  const seen: Captured[] = [];
  const id = await indexFace(cfg, { collectionId: "c", image: new Uint8Array([1]), externalImageId: "user-1" },
    fakeFetch(200, { FaceRecords: [{ Face: { FaceId: "f9" } }] }, seen));
  assertEquals(id, "f9");
  assertEquals(JSON.parse(seen[0].body).MaxFaces, 1);
  assertEquals(await indexFace(cfg, { collectionId: "c", image: new Uint8Array([1]), externalImageId: "u" },
    fakeFetch(200, { FaceRecords: [], UnindexedFaces: [{}] })), null);
});

Deno.test("deleteFaces skips the call for an empty list", async () => {
  const seen: Captured[] = [];
  await deleteFaces(cfg, { collectionId: "c", faceIds: [] }, fakeFetch(200, {}, seen));
  assertEquals(seen.length, 0);
  await deleteFaces(cfg, { collectionId: "c", faceIds: ["a", "b"] }, fakeFetch(200, {}, seen));
  assertEquals(JSON.parse(seen[0].body).FaceIds, ["a", "b"]);
});

Deno.test("livenessVerdict follows the spec table", () => {
  const ref = new Uint8Array([1]);
  assertEquals(livenessVerdict({ status: "SUCCEEDED", confidence: 80, referenceImage: ref }, 80), "approved");
  assertEquals(livenessVerdict({ status: "SUCCEEDED", confidence: 42, referenceImage: ref }, 80), "declined");
  assertEquals(livenessVerdict({ status: "SUCCEEDED", confidence: 97, referenceImage: null }, 80), "retry");
  assertEquals(livenessVerdict({ status: "SUCCEEDED", confidence: null, referenceImage: ref }, 80), "retry");
  assertEquals(livenessVerdict({ status: "FAILED", confidence: null, referenceImage: null }, 80), "failed");
  assertEquals(livenessVerdict({ status: "EXPIRED", confidence: null, referenceImage: null }, 80), "failed");
  assertEquals(livenessVerdict({ status: "CREATED", confidence: null, referenceImage: null }, 80), "pending");
  assertEquals(livenessVerdict({ status: "IN_PROGRESS", confidence: null, referenceImage: null }, 80), "pending");
});

Deno.test("base64 round trip on a large buffer", () => {
  const big = new Uint8Array(200_000).map((_, i) => i % 256);
  assertEquals(decodeBase64(encodeBase64(big)), big);
});
