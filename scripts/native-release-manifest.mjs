import fs from "node:fs";
import path from "node:path";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizeBoolean(value) {
  return value === "true";
}

function readOptionalText(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return "";
  }

  return fs.readFileSync(filePath, "utf8").trim();
}

const manifestPath = requireEnv("RELEASE_MANIFEST_PATH");
const appPath = requireEnv("APP_PATH");
const zipPath = requireEnv("ZIP_PATH");
const executablePath = requireEnv("EXECUTABLE_PATH");

const manifest = {
  generatedAt: requireEnv("BUILD_TIME"),
  productName: requireEnv("PRODUCT_NAME"),
  version: requireEnv("APP_VERSION"),
  identifier: requireEnv("APP_IDENTIFIER"),
  branch: process.env.BUILD_BRANCH || null,
  commit: process.env.BUILD_COMMIT || null,
  dirty: normalizeBoolean(process.env.BUILD_DIRTY || "false"),
  manifest: {
    path: manifestPath,
    latestPath: process.env.RELEASE_LATEST_MANIFEST_PATH || null,
  },
  bundle: {
    path: appPath,
    exists: fs.existsSync(appPath),
  },
  executable: {
    path: executablePath,
    exists: fs.existsSync(executablePath),
    sha256: process.env.EXECUTABLE_SHA256 || null,
  },
  archive: {
    path: zipPath,
    exists: fs.existsSync(zipPath),
    sha256: process.env.ZIP_SHA256 || null,
    bytes: fs.existsSync(zipPath) ? fs.statSync(zipPath).size : 0,
  },
  signing: {
    mode: requireEnv("SIGN_MODE"),
    identity: process.env.SIGNED_IDENTITY || null,
    performed: normalizeBoolean(process.env.SIGNING_PERFORMED || "false"),
    timestampMode: process.env.SIGNING_TIMESTAMP_MODE || null,
  },
  verification: {
    codesignStatus: process.env.CODESIGN_STATUS || "unknown",
    spctlStatus: process.env.SPCTL_STATUS || "unknown",
    codesignVerifyLog: process.env.CODESIGN_VERIFY_LOG || null,
    codesignDisplayLog: process.env.CODESIGN_DISPLAY_LOG || null,
    spctlLog: process.env.SPCTL_LOG || null,
  },
  diagnostics: {
    codesignVerify: readOptionalText(process.env.CODESIGN_VERIFY_LOG),
    codesignDisplay: readOptionalText(process.env.CODESIGN_DISPLAY_LOG),
    spctl: readOptionalText(process.env.SPCTL_LOG),
  },
};

fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
