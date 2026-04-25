export type EnvironmentType = "aws" | "k8s" | "region" | "custom";

export interface EnvironmentRecord {
  id: string;
  name: string;
  type: EnvironmentType;
  createdAt: string;
  updatedAt: string;
}

export const sampleEnvironments: EnvironmentRecord[] = [
  {
    id: "env-prod",
    name: "Acme / Production",
    type: "aws",
    createdAt: "2026-03-20T12:00:00.000Z",
    updatedAt: "2026-03-20T12:00:00.000Z",
  },
  {
    id: "env-svc",
    name: "Acme / Services",
    type: "k8s",
    createdAt: "2026-03-18T08:30:00.000Z",
    updatedAt: "2026-03-18T08:30:00.000Z",
  },
  {
    id: "env-net",
    name: "Network / Edge",
    type: "region",
    createdAt: "2026-03-12T09:40:00.000Z",
    updatedAt: "2026-03-12T09:40:00.000Z",
  },
  {
    id: "env-local",
    name: "Workstation / Local",
    type: "custom",
    createdAt: "2026-04-04T21:00:00.000Z",
    updatedAt: "2026-04-04T21:00:00.000Z",
  }
];
