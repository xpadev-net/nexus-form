/**
 * Efficient deep equality comparison utility
 * Replaces JSON.stringify for better performance and reliability
 *
 * This utility provides robust deep equality comparison for complex objects,
 * arrays, and nested structures. It's optimized for use in memo
 * comparison functions and other scenarios where deep equality is needed.
 *
 * @example
 * ```typescript
 * const obj1 = { a: 1, b: { c: 2 } };
 * const obj2 = { a: 1, b: { c: 2 } };
 * console.log(deepEqual(obj1, obj2)); // true
 * ```
 */

/**
 * Compares two values for deep equality
 *
 * Performs a comprehensive deep comparison of two values, handling:
 * - Primitive values (string, number, boolean, null, undefined)
 * - Objects with nested properties
 * - Arrays with nested elements
 * - Mixed data structures
 *
 * @param a - First value to compare
 * @param b - Second value to compare
 * @returns `true` if values are deeply equal, `false` otherwise
 *
 * @example
 * ```typescript
 * // Primitive comparison
 * deepEqual(1, 1); // true
 * deepEqual("hello", "world"); // false
 *
 * // Object comparison
 * deepEqual({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } }); // true
 * deepEqual({ a: 1 }, { a: 2 }); // false
 *
 * // Array comparison
 * deepEqual([1, 2, { a: 3 }], [1, 2, { a: 3 }]); // true
 * deepEqual([1, 2], [1, 2, 3]); // false
 * ```
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  if (a == null || b == null) return a === b;

  if (typeof a !== typeof b) return false;

  if (typeof a !== "object") return a === b;

  if (Array.isArray(a) !== Array.isArray(b)) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);

  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!keysB.includes(key)) return false;
    if (
      !deepEqual(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
      )
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Compares two arrays for deep equality
 *
 * Optimized version of deepEqual specifically for array comparison.
 * Provides better performance when comparing arrays by avoiding
 * unnecessary type checks and object property iteration.
 *
 * @param a - First array to compare
 * @param b - Second array to compare
 * @returns `true` if arrays are deeply equal, `false` otherwise
 *
 * @example
 * ```typescript
 * // Simple array comparison
 * deepEqualArrays([1, 2, 3], [1, 2, 3]); // true
 * deepEqualArrays([1, 2], [1, 2, 3]); // false
 *
 * // Complex array comparison
 * deepEqualArrays(
 *   [{ id: 1, name: "John" }, { id: 2, name: "Jane" }],
 *   [{ id: 1, name: "John" }, { id: 2, name: "Jane" }]
 * ); // true
 * ```
 */
export function deepEqualArrays<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    if (!deepEqual(a[i], b[i])) return false;
  }

  return true;
}
