export type HostEnvironmentKind = "custom" | "account" | "cluster" | "region";

export interface HostEnvironmentRecord {
  id: string;
  label: string;
  kind: HostEnvironmentKind;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface HostEnvironmentFormValues {
  label: string;
  kind: HostEnvironmentKind;
  description: string;
}

export const defaultHostEnvironmentKind: HostEnvironmentKind = "custom";

export const emptyHostEnvironmentFormValues: HostEnvironmentFormValues = {
  label: "",
  kind: defaultHostEnvironmentKind,
  description: "",
};

export function formatHostEnvironmentKind(kind: HostEnvironmentKind) {
  switch (kind) {
    case "account":
      return "Account";
    case "cluster":
      return "Cluster";
    case "region":
      return "Region";
    case "custom":
    default:
      return "Custom";
  }
}

