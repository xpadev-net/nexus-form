import {
  FormStructure,
  type FormStructure as FormStructureType,
} from "../../types/domain/form";

export const DEFAULT_FORM_STRUCTURE: FormStructureType = FormStructure.parse({
  version: 1,
  settings: {
    allow_edit_responses: false,
  },
});

export const DEFAULT_FORM_STRUCTURE_JSON = JSON.stringify(
  DEFAULT_FORM_STRUCTURE,
);
