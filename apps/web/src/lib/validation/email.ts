// Email validation utility

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validates whether the given string is a valid email address.
 */
export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}
