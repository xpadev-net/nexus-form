export function getAssociatedLabel(
  container: HTMLElement,
  input: HTMLInputElement,
): HTMLLabelElement {
  const label = container.querySelector<HTMLLabelElement>(
    `label[for="${input.id}"]`,
  );
  if (!label) {
    throw new Error(`Expected label for ${input.id}`);
  }
  return label;
}

export function clickAssociatedLabel(
  container: HTMLElement,
  input: HTMLInputElement,
) {
  getAssociatedLabel(container, input).click();
}

export function requireInput(element: HTMLElement): HTMLInputElement {
  if (!(element instanceof HTMLInputElement)) {
    throw new Error("Expected a native input element");
  }
  return element;
}
