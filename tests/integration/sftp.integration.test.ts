import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createRemoteDirectory,
  deleteRemoteEntry,
  downloadRemoteFile,
  listRemoteDirectory,
  renameRemoteEntry,
  uploadRemoteFile,
  type BackendHostConnection,
} from "../../apps/desktop/src/lib/api";
import { resetDemoBackend } from "../../apps/desktop/src/lib/demo-backend";
import { useAppStore } from "../../apps/desktop/src/store/app-store";

const baseAppState = useAppStore.getState();
const productionGateway: BackendHostConnection = {
  agentForwarding: true,
  authMethod: "privateKey",
  environment: {
    APP_ENV: "production",
  },
  hostname: "bastion.acme.internal",
  password: "",
  passphrase: "",
  port: 22,
  privateKeyPath: "~/.ssh/id_ed25519",
  sftpRoot: "/srv",
  username: "ops",
};

beforeEach(() => {
  resetDemoBackend();
  useAppStore.setState({
    ...useAppStore.getState(),
    demoModeEnabled: true,
  });
});

afterEach(() => {
  resetDemoBackend();
  useAppStore.setState(baseAppState);
});

describe("demo sftp workflows", () => {
  it("lists seeded directories and supports create, rename, upload, download, and delete", async () => {
    const initialList = await listRemoteDirectory(productionGateway, "/srv");
    expect(initialList.entries.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(["apps", "backups", "deploy.log", "README.md", "releases"])
    );

    await createRemoteDirectory(productionGateway, "/srv/releases-candidate");
    await renameRemoteEntry(
      productionGateway,
      "/srv/releases-candidate",
      "/srv/releases-validated"
    );

    await uploadRemoteFile(
      productionGateway,
      "/srv/releases-validated/notes.txt",
      new File(["validated build"], "notes.txt", { type: "text/plain" })
    );

    const uploadedFile = await downloadRemoteFile(
      productionGateway,
      "/srv/releases-validated/notes.txt"
    );
    expect(uploadedFile.filename).toBe("notes.txt");
    await expect(uploadedFile.blob.text()).resolves.toBe("validated build");

    await deleteRemoteEntry(productionGateway, "/srv/releases-validated/notes.txt", false);
    await deleteRemoteEntry(productionGateway, "/srv/releases-validated", true);

    const finalList = await listRemoteDirectory(productionGateway, "/srv");
    expect(finalList.entries.map((entry) => entry.name)).not.toContain("releases-validated");
  });
});
