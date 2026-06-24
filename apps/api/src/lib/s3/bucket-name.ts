export function validateBucketName(bucketName: string): boolean {
  const bucketNameRegex = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

  if (bucketName.length < 3 || bucketName.length > 63) {
    return false;
  }

  if (!bucketNameRegex.test(bucketName)) {
    return false;
  }

  if (
    bucketName.includes("..") ||
    bucketName.includes(".-") ||
    bucketName.includes("-.")
  ) {
    return false;
  }

  return !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(bucketName);
}
