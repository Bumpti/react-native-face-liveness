/**
 * Local backend for trying the module on a phone, without any app server.
 *
 *   FACE_LIVENESS_APP=<app> AWS_PROFILE=<profile> deno run --node-modules-dir=none --allow-net --allow-run=aws --allow-env --allow-sys=networkInterfaces example/dev-server.ts
 *
 * It signs with the AWS CLI profile's own credentials (`aws configure export-credentials`),
 * so run scripts/aws-setup.sh first and keep the profile signed in. The phone must reach
 * this machine (same Wi-Fi); the server prints its LAN address.
 *
 *   POST /start              → { sessionId, region, credentials }
 *   POST /finish {sessionId} → { status, confidence, verdict, feedback, hasReferenceImage }
 */
import {
  type AwsConfig,
  createLivenessSession,
  getLivenessResult,
  issueClientCredentials,
  livenessVerdict,
} from "../server/mod.ts";

const APP = Deno.env.get("FACE_LIVENESS_APP");
if (!APP) throw new Error("Set FACE_LIVENESS_APP to the <app> name you gave scripts/aws-setup.sh");
const REGION = Deno.env.get("AWS_REGION") ?? "us-east-1";
const PORT = Number(Deno.env.get("PORT") ?? 8787);
const MIN_CONFIDENCE = Number(Deno.env.get("MIN_CONFIDENCE") ?? 80);

async function serverCredentials(): Promise<AwsConfig> {
  const out = await new Deno.Command("aws", {
    args: ["configure", "export-credentials", "--format", "process"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!out.success) throw new Error(new TextDecoder().decode(out.stderr));
  const creds = JSON.parse(new TextDecoder().decode(out.stdout));
  return {
    accessKeyId: creds.AccessKeyId,
    secretAccessKey: creds.SecretAccessKey,
    sessionToken: creds.SessionToken,
    region: REGION,
  };
}

async function accountId(cfg: AwsConfig): Promise<string> {
  const out = await new Deno.Command("aws", {
    args: ["sts", "get-caller-identity", "--query", "Account", "--output", "text"],
    stdout: "piped",
  }).output();
  return new TextDecoder().decode(out.stdout).trim() || (() => {
    throw new Error(`no account for ${cfg.accessKeyId.slice(0, 4)}…`);
  })();
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

Deno.serve({ port: PORT, hostname: "0.0.0.0" }, async (request) => {
  const url = new URL(request.url);
  try {
    const cfg = await serverCredentials();
    if (request.method === "POST" && url.pathname === "/start") {
      const sessionId = await createLivenessSession(cfg);
      const roleArn = `arn:aws:iam::${await accountId(cfg)}:role/${APP}-liveness-client`;
      const credentials = await issueClientCredentials(cfg, { roleArn, sessionName: `dev-${Date.now()}` });
      console.log(`start ${sessionId}`);
      return json({ sessionId, region: REGION, credentials });
    }
    if (request.method === "POST" && url.pathname === "/finish") {
      const { sessionId } = await request.json();
      const result = await getLivenessResult(cfg, sessionId);
      const verdict = livenessVerdict(result, MIN_CONFIDENCE);
      console.log(`finish ${sessionId}: ${result.status} ${result.confidence ?? "-"} → ${verdict}`);
      return json({
        status: result.status,
        confidence: result.confidence,
        verdict,
        feedback: result.feedback,
        hasReferenceImage: result.referenceImage !== null,
      });
    }
    return json({ error: "not_found" }, 404);
  } catch (error) {
    console.error(error);
    return json({ error: String(error) }, 500);
  }
});

const lan = Deno.networkInterfaces().find((i) => i.family === "IPv4" && !i.address.startsWith("127."));
console.log(`face liveness dev server on http://${lan?.address ?? "localhost"}:${PORT} (app ${APP}, ${REGION})`);
