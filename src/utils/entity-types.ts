/**
 * Dynatrace Entity Types mapping.
 * Maps entity ID prefixes to their corresponding Dynatrace entity types.
 */

const ENTITY_ID_PREFIX_TO_TYPE_MAP_BASICS: Record<string, string> = {
  APPLICATION: "dt.entity.application",
  SERVICE: "dt.entity.service",
  MOBILE_APPLICATION: "dt.entity.mobile_application",
  CUSTOM_APPLICATION: "dt.entity.custom_application",
  HOST: "dt.entity.host",
  HOST_GROUP: "dt.entity.host_group",
  PROCESS_GROUP: "dt.entity.process_group",
  DISK: "dt.entity.disk",
  NETWORK_INTERFACE: "dt.entity.network_interface",
  CLOUD_APPLICATION: "dt.entity.cloud_application",
  CLOUD_APPLICATION_NAMESPACE: "dt.entity.cloud_application_namespace",
  CONTAINER_GROUP: "dt.entity.container_group",
  ENVIRONMENT: "dt.entity.environment",
  OS: "dt.entity.os",
  SYNTHETIC_TEST: "dt.entity.synthetic_test",
  SYNTHETIC_LOCATION: "dt.entity.synthetic_location",
  CUSTOM_DEVICE: "dt.entity.custom_device",
  CUSTOM_DEVICE_GROUP: "dt.entity.custom_device_group",
  GEOLOCATION: "dt.entity.geolocation",
  RELATIONAL_DATABASE_SERVICE: "dt.entity.relational_database_service",
  KUBERNETES_NODE: "dt.entity.kubernetes_node",
  KUBERNETES_CLUSTER: "dt.entity.kubernetes_cluster",
  KUBERNETES_SERVICE: "dt.entity.kubernetes_service",
};

const ENTITY_ID_PREFIX_TO_TYPE_MAP_ALL: Record<string, string> = {
  ...ENTITY_ID_PREFIX_TO_TYPE_MAP_BASICS,
  SERVICE_INSTANCE: "dt.entity.service_instance",
  PROCESS_GROUP_INSTANCE: "dt.entity.process_group_instance",
  CLOUD_APPLICATION_INSTANCE: "dt.entity.cloud_application_instance",
  DCG_INSTANCE: "dt.entity.docker_container_group_instance",
  CONTAINER_GROUP_INSTANCE: "dt.entity.container_group_instance",
  EC2_INSTANCE: "dt.entity.ec2_instance",
  AWS_LAMBDA_FUNCTION: "dt.entity.aws_lambda_function",
  AWS_AVAILABILITY_ZONE: "dt.entity.aws_availability_zone",
  AWS_APPLICATION_LOAD_BALANCER: "dt.entity.aws_application_load_balancer",
  AWS_NETWORK_LOAD_BALANCER: "dt.entity.aws_network_load_balancer",
  GCP_ZONE: "dt.entity.gcp_zone",
  AZURE_VM: "dt.entity.azure_vm",
  OPENSTACK_VM: "dt.entity.openstack_vm",
};

export const DYNATRACE_ENTITY_TYPES_BASICS = Object.values(
  ENTITY_ID_PREFIX_TO_TYPE_MAP_BASICS,
).sort();

export const DYNATRACE_ENTITY_TYPES_ALL = Object.values(
  ENTITY_ID_PREFIX_TO_TYPE_MAP_ALL,
).sort();

/**
 * Maps a Dynatrace entity ID to its corresponding entity type.
 */
export function getEntityTypeFromId(entityId: string): string | null {
  if (!entityId || typeof entityId !== "string") return null;

  const hyphenIndex = entityId.indexOf("-");
  if (hyphenIndex === -1) return null;

  const prefix = entityId.substring(0, hyphenIndex);
  return ENTITY_ID_PREFIX_TO_TYPE_MAP_ALL[prefix] || null;
}
