export function buildPublicFormPath(publicId: string): string {
  return `/forms/public/${publicId}`;
}

export function buildPublicFormUrl(publicId: string): string {
  return `${window.location.origin}${buildPublicFormPath(publicId)}`;
}
