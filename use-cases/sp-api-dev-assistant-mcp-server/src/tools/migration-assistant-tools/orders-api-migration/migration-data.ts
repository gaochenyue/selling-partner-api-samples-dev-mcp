import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface ApiMapping {
  v1: string;
  status: string;
  notes: string;
}

export interface IncludedDataParameter {
  description: string;
  attributes: string[];
  notes?: string;
}

export interface StatusMappings {
  fulfillmentStatus: Record<string, string>;
  fulfillmentChannel: Record<string, string>;
}

export interface PackageTracking {
  description: string;
  attributes: Record<string, string>;
}

export interface ProgramsList {
  orderLevel: string[];
  orderItemLevel: string[];
}

export interface MigrationData {
  deprecated: string[];
  notSupported: string[];
  attributeMappings: Record<string, string>;
  newFeatures: string[];
  apiMappings: Record<string, ApiMapping>;
  includedDataParameters: Record<string, IncludedDataParameter>;
  statusMappings: StatusMappings;
  queryParameterMappings: Record<string, string>;
  packageTracking: PackageTracking;
  programsList: ProgramsList;
  migrationBenefits: string[];
}

export function getOrdersApiMigrationData(): MigrationData {
  const resourcePath = join(
    __dirname,
    "..",
    "..",
    "..",
    "resources",
    "orders-api-migration-data.json",
  );
  const jsonData = JSON.parse(readFileSync(resourcePath, "utf-8"));

  return {
    deprecated: jsonData.deprecated,
    notSupported: jsonData.notSupported,
    attributeMappings: jsonData.attributeMappings,
    newFeatures: jsonData.newFeatures,
    apiMappings: jsonData.apiMappings,
    includedDataParameters: jsonData.includedDataParameters,
    statusMappings: jsonData.statusMappings,
    queryParameterMappings: jsonData.queryParameterMappings,
    packageTracking: jsonData.packageTracking,
    programsList: jsonData.programsList,
    migrationBenefits: jsonData.migrationBenefits,
  };
}
