import { renderToStaticMarkup } from "react-dom/server";
import { RatingQuestionComponent } from "./rating-question";

const ratingBlock = {
  id: "db-id",
  formId: "form-1",
  blockId: "rating-block",
  type: "rating",
  category: "question",
  order: 0,
  version: 1,
  isDeleted: false,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  createdBy: "user-1",
  updatedBy: "user-1",
  title: "Satisfaction",
  description: "Rate your experience",
  validation: {
    type: "rating",
    required: false,
    maxRating: 5,
    icon: "star",
  },
} as const;

describe("RatingQuestion radio selection", () => {
  it("renders exactly one checked radio for a selected value", () => {
    const html = renderToStaticMarkup(
      <RatingQuestionComponent
        block={ratingBlock}
        value={3}
        onChange={() => {}}
      />,
    );

    const checkedInputs = html.match(/type="radio"[^>]*checked=""/g) ?? [];
    expect(checkedInputs).toHaveLength(1);
    expect(checkedInputs[0]).toContain('name="rating-block-rating"');
    expect(checkedInputs[0]).toContain('aria-label="3つ星"');
  });
});
