import { describe, expect, it } from "vitest";
import {
  buildResponseExportRecords,
  formatRecordsToCsv,
  mapRecordToSheetRow,
  type ResponseExportRecord,
} from "../response-export";

const submittedAt = new Date("2026-05-17T01:00:00.000Z");

const formBlocks = [
  {
    blockId: "name-block",
    category: "question",
    type: "short_text",
    content: { title: "氏名", validation: {} },
  },
  {
    blockId: "choice-block",
    category: "question",
    type: "radio",
    content: {
      title: "希望枠",
      validation: {
        options: [
          { id: "morning", label: "午前" },
          { id: "afternoon", label: "午後" },
        ],
      },
    },
  },
  {
    blockId: "checkbox-block",
    category: "question",
    type: "checkbox",
    content: {
      title: "興味",
      validation: {
        options: [
          { id: "ts", label: "TypeScript" },
          { id: "react", label: "React" },
        ],
      },
    },
  },
  {
    blockId: "grid-block",
    category: "question",
    type: "choice_grid",
    content: {
      title: "参加可能日",
      validation: {
        rows: [{ id: "monday", label: "月曜" }],
        columns: [{ id: "morning", label: "午前" }],
      },
    },
  },
  {
    blockId: "rating-block",
    category: "question",
    type: "rating",
    content: { title: "満足度", validation: { maxRating: 5 } },
  },
  {
    blockId: "missing-block",
    category: "question",
    type: "short_text",
    content: { title: "未回答", validation: {} },
  },
  {
    blockId: "system-block",
    category: "system",
    type: "section_separator",
    content: { title: "区切り", validation: {} },
  },
];

const blockTitleMap = new Map(
  formBlocks.map((block) => [
    block.blockId,
    typeof block.content === "object" && block.content !== null
      ? String((block.content as { title?: unknown }).title ?? block.blockId)
      : block.blockId,
  ]),
);

describe("response export", () => {
  it("reflects saved responseDataJson values in export records and CSV output", () => {
    const { records, fingerprintComponents } = buildResponseExportRecords(
      "form-1",
      [
        {
          id: "response-1",
          formId: "form-1",
          responseDataJson: JSON.stringify([
            {
              question_id: "name-block",
              question_type: "short_text",
              value: "山田 太郎",
            },
            {
              question_id: "choice-block",
              question_type: "radio",
              value: "morning",
            },
            {
              question_id: "checkbox-block",
              question_type: "checkbox",
              values: ["ts", "react"],
            },
            {
              question_id: "grid-block",
              question_type: "choice_grid",
              responses: { monday: "morning" },
            },
            {
              question_id: "rating-block",
              question_type: "rating",
              value: 5,
            },
          ]),
          respondentUuid: "respondent-1",
          submittedAt,
          updatedAt: null,
          userAgent: null,
          sessionId: null,
          countryCode: "JP",
          fingerprintDetails: [],
        },
      ],
      formBlocks,
    );

    expect(records).toHaveLength(1);
    expect(records[0]?.component_columns).toEqual([
      {
        block_id: "name-block",
        block_type: "short_text",
        question_title: undefined,
        value: "山田 太郎",
      },
      {
        block_id: "choice-block",
        block_type: "radio",
        question_title: undefined,
        value: "morning",
        display_value: "午前",
      },
      {
        block_id: "checkbox-block",
        block_type: "checkbox",
        question_title: undefined,
        value: ["ts", "react"],
        display_value: ["TypeScript", "React"],
      },
      {
        block_id: "grid-block",
        block_type: "choice_grid",
        question_title: undefined,
        value: { monday: "morning" },
        display_value: "月曜: 午前",
      },
      {
        block_id: "rating-block",
        block_type: "rating",
        question_title: undefined,
        value: 5,
      },
      {
        block_id: "missing-block",
        block_type: "short_text",
        question_title: undefined,
        value: null,
      },
    ]);

    const csv = formatRecordsToCsv(
      records,
      fingerprintComponents,
      blockTitleMap,
    );

    expect(csv.split("\n")[0]).toBe(
      '"回答ID","回答者UUID","送信日時","更新日時","国コード","UA UUID","ユニーク度スコア","氏名","希望枠","興味","参加可能日","満足度","未回答"',
    );
    expect(csv.split("\n")[1]).toBe(
      '"response-1","respondent-1","2026-05-17T01:00:00.000Z","","JP","","1.0000","山田 太郎","午前","TypeScript, React","月曜: 午前","5",""',
    );
    expect(csv).not.toContain("区切り");
  });

  it("returns a header row when CSV output has no records", () => {
    const questionTitleMap = new Map([
      ["name-block", "氏名"],
      ["choice-block", "希望枠"],
      ["system-block", "区切り"],
    ]);

    expect(
      formatRecordsToCsv([], new Set(), questionTitleMap, [
        "name-block",
        "choice-block",
      ]),
    ).toBe(
      '"回答ID","回答者UUID","送信日時","更新日時","国コード","UA UUID","ユニーク度スコア","氏名","希望枠"',
    );
  });

  it("neutralizes spreadsheet formula triggers in CSV cell values", () => {
    const record: ResponseExportRecord = {
      metadata: {
        id: "=response-1",
        form_id: "form-1",
        respondent_uuid: "respondent-1",
        submitted_at: "2026-05-17T01:00:00.000Z",
        updated_at: "\t2026-05-17T02:30:00.000Z",
        country_code: "JP",
        fingerprint_uuids: {
          "=canvas": "+fingerprint",
        },
        ua_uuid: " @ua",
        uniqueness_score: 1,
      },
      component_columns: [
        {
          block_id: "text-block",
          block_type: "short_text",
          value: " =cmd",
        },
        {
          block_id: "date-block",
          block_type: "date",
          value: "\r2026-06-13",
        },
        {
          block_id: "radio-block",
          block_type: "radio",
          value: "+choice",
        },
        {
          block_id: "checkbox-block",
          block_type: "checkbox",
          value: ["@danger", "normal"],
        },
        {
          block_id: "long-text-block",
          block_type: "long_text",
          value: "\nlong text",
        },
        {
          block_id: "minus-block",
          block_type: "short_text",
          value: "-1",
        },
        {
          block_id: "normal-block",
          block_type: "short_text",
          value: "plain value",
        },
      ],
    };
    const formulaTitleMap = new Map([
      ["text-block", "=Text"],
      ["date-block", "Date"],
      ["radio-block", "Radio"],
      ["checkbox-block", "Checkbox"],
      ["long-text-block", "Long text"],
      ["minus-block", "-Minus"],
      ["normal-block", "Normal"],
    ]);

    const csv = formatRecordsToCsv(
      [record],
      new Set(["=canvas"]),
      formulaTitleMap,
    );

    expect(csv.split("\n")[0]).toContain('"\'=Text"');
    expect(csv.split("\n")[0]).toContain('"\'-Minus"');
    expect(csv.split("\n")[0]).toContain('"\'=canvas UUID"');
    for (const expectedCell of [
      '"\'=response-1"',
      '"\'\t2026-05-17T02:30:00.000Z"',
      '"\' @ua"',
      '"\'+fingerprint"',
      '"\' =cmd"',
      '"\'\r2026-06-13"',
      '"\'+choice"',
      '"\'@danger, normal"',
      '"\'\nlong text"',
      '"\'-1"',
      '"plain value"',
    ]) {
      expect(csv).toContain(expectedCell);
    }
    expect(csv).not.toContain('"\'plain value"');
  });

  it("keeps R26-M1 S16 CSV headers and values for date, time, submitted datetime, rating, and slider fields", () => {
    const s16Blocks = [
      {
        blockId: "s16-date",
        category: "question",
        type: "date",
        content: { title: "予約日", validation: {} },
      },
      {
        blockId: "s16-time",
        category: "question",
        type: "time",
        content: { title: "予約時刻", validation: {} },
      },
      {
        blockId: "s16-rating",
        category: "question",
        type: "rating",
        content: { title: "満足度", validation: { maxRating: 5 } },
      },
      {
        blockId: "s16-slider",
        category: "question",
        type: "linear_scale",
        content: { title: "スライダー", validation: { min: 1, max: 10 } },
      },
    ];
    const s16TitleMap = new Map([
      ["s16-date", "予約日"],
      ["s16-time", "予約時刻"],
      ["s16-rating", "満足度"],
      ["s16-slider", "スライダー"],
    ]);

    const { records, fingerprintComponents } = buildResponseExportRecords(
      "form-s16",
      [
        {
          id: "response-s16",
          formId: "form-s16",
          responseDataJson: JSON.stringify([
            {
              question_id: "s16-date",
              question_type: "date",
              value: "2026-06-16",
            },
            {
              question_id: "s16-time",
              question_type: "time",
              value: "10:30",
            },
            {
              question_id: "s16-rating",
              question_type: "rating",
              value: 4,
            },
            {
              question_id: "s16-slider",
              question_type: "linear_scale",
              value: 7,
            },
          ]),
          respondentUuid: "respondent-s16",
          submittedAt,
          updatedAt: new Date("2026-05-17T02:30:00.000Z"),
          userAgent: null,
          sessionId: null,
          countryCode: "JP",
          fingerprintDetails: [],
        },
      ],
      s16Blocks,
    );

    const csv = formatRecordsToCsv(records, fingerprintComponents, s16TitleMap);

    expect(csv.split("\n")[0]).toBe(
      '"回答ID","回答者UUID","送信日時","更新日時","国コード","UA UUID","ユニーク度スコア","予約日","予約時刻","満足度","スライダー"',
    );
    expect(csv.split("\n")[1]).toBe(
      '"response-s16","respondent-s16","2026-05-17T01:00:00.000Z","2026-05-17T02:30:00.000Z","JP","","1.0000","2026-06-16","10:30","4","7"',
    );
  });

  it("keeps unvisited section-branch answers blank in creator export records and CSV", () => {
    const branchBlocks = [
      {
        blockId: "q-entity-type",
        category: "question",
        type: "radio",
        content: {
          title: "契約種別",
          validation: {
            options: [
              { id: "individual", label: "個人" },
              { id: "corporate", label: "法人" },
            ],
          },
        },
      },
      {
        blockId: "section-corporate",
        category: "system",
        type: "section_separator",
        content: { title: "法人追加情報", validation: {} },
      },
      {
        blockId: "q-company-name",
        category: "question",
        type: "short_text",
        content: { title: "法人名", validation: { required: true } },
      },
    ];
    const branchTitleMap = new Map([
      ["q-entity-type", "契約種別"],
      ["q-company-name", "法人名"],
    ]);

    const { records, fingerprintComponents } = buildResponseExportRecords(
      "form-branch",
      [
        {
          id: "response-individual",
          formId: "form-branch",
          responseDataJson: JSON.stringify([
            {
              question_id: "q-entity-type",
              question_type: "radio",
              question_title: "契約種別",
              value: "individual",
            },
          ]),
          respondentUuid: "respondent-individual",
          submittedAt,
          updatedAt: null,
          userAgent: null,
          sessionId: null,
          countryCode: "JP",
          fingerprintDetails: [],
        },
        {
          id: "response-corporate",
          formId: "form-branch",
          responseDataJson: JSON.stringify([
            {
              question_id: "q-entity-type",
              question_type: "radio",
              question_title: "契約種別",
              value: "corporate",
            },
            {
              question_id: "q-company-name",
              question_type: "short_text",
              question_title: "法人名",
              value: "Nexus 株式会社",
            },
          ]),
          respondentUuid: "respondent-corporate",
          submittedAt,
          updatedAt: null,
          userAgent: null,
          sessionId: null,
          countryCode: "JP",
          fingerprintDetails: [],
        },
      ],
      branchBlocks,
    );

    expect(records[0]?.component_columns).toEqual([
      expect.objectContaining({
        block_id: "q-entity-type",
        value: "individual",
        display_value: "個人",
      }),
      expect.objectContaining({
        block_id: "q-company-name",
        value: null,
      }),
    ]);
    expect(records[1]?.component_columns).toEqual([
      expect.objectContaining({
        block_id: "q-entity-type",
        value: "corporate",
        display_value: "法人",
      }),
      expect.objectContaining({
        block_id: "q-company-name",
        value: "Nexus 株式会社",
      }),
    ]);

    const csv = formatRecordsToCsv(
      records,
      fingerprintComponents,
      branchTitleMap,
    );

    expect(csv.split("\n")[0]).toBe(
      '"回答ID","回答者UUID","送信日時","更新日時","国コード","UA UUID","ユニーク度スコア","契約種別","法人名"',
    );
    expect(csv.split("\n")[1]).toBe(
      '"response-individual","respondent-individual","2026-05-17T01:00:00.000Z","","JP","","1.0000","個人",""',
    );
    expect(csv.split("\n")[2]).toBe(
      '"response-corporate","respondent-corporate","2026-05-17T01:00:00.000Z","","JP","","1.0000","法人","Nexus 株式会社"',
    );
    expect(csv).not.toContain("法人追加情報");
  });

  it("prefers display labels when mapping records to sheet rows", () => {
    const record: ResponseExportRecord = {
      metadata: {
        id: "response-1",
        form_id: "form-1",
        respondent_uuid: "respondent-1",
        submitted_at: "2026-05-17T01:00:00.000Z",
        country_code: "JP",
        ua_uuid: null,
        uniqueness_score: 1,
      },
      component_columns: [
        {
          block_id: "choice-block",
          block_type: "radio",
          value: "morning",
          display_value: "午前",
        },
        {
          block_id: "checkbox-block",
          block_type: "checkbox",
          value: ["ts", "react"],
          display_value: ["TypeScript", "React"],
        },
        {
          block_id: "grid-block",
          block_type: "choice_grid",
          value: { monday: "morning" },
          display_value: "月曜: 午前",
        },
      ],
    };

    const newLayoutRow = mapRecordToSheetRow(record, [], blockTitleMap);
    expect(newLayoutRow.row.slice(-3)).toEqual([
      "午前",
      "TypeScript, React",
      "月曜: 午前",
    ]);

    const existingLayoutRow = mapRecordToSheetRow(
      record,
      newLayoutRow.idRow,
      blockTitleMap,
      undefined,
      newLayoutRow.titleRow,
    );
    expect(existingLayoutRow.row.slice(-3)).toEqual([
      "午前",
      "TypeScript, React",
      "月曜: 午前",
    ]);
  });

  it("neutralizes formula triggers in sheet rows and headers", () => {
    const record: ResponseExportRecord = {
      metadata: {
        id: "=response-1",
        form_id: "form-1",
        respondent_uuid: "-respondent-1",
        submitted_at: "2026-05-17T01:00:00.000Z",
        updated_at: "\t2026-05-17T02:30:00.000Z",
        country_code: "JP",
        fingerprint_uuids: {
          "=canvas": "+fingerprint",
        },
        ua_uuid: " @ua",
        uniqueness_score: 1,
      },
      component_columns: [
        {
          block_id: "=text-block",
          block_type: "short_text",
          question_title: "=Text",
          value: " =cmd",
        },
        {
          block_id: "-minus-block",
          block_type: "short_text",
          question_title: "-Minus",
          value: "-1",
        },
        {
          block_id: "normal-block",
          block_type: "short_text",
          question_title: "Normal",
          value: "plain value",
        },
      ],
    };
    const sheetTitleMap = new Map([
      ["=text-block", "=Text"],
      ["-minus-block", "-Minus"],
      ["normal-block", "Normal"],
    ]);

    const newLayoutRow = mapRecordToSheetRow(
      record,
      [],
      sheetTitleMap,
      new Set(["=canvas"]),
    );

    expect(newLayoutRow.idRow).toContain("'=canvas UUID");
    expect(newLayoutRow.idRow).toContain("'=text-block");
    expect(newLayoutRow.idRow).toContain("'-minus-block");
    expect(newLayoutRow.titleRow).toContain("'=Text");
    expect(newLayoutRow.titleRow).toContain("'-Minus");
    for (const expectedCell of [
      "'=response-1",
      "'-respondent-1",
      "'\t2026-05-17T02:30:00.000Z",
      "' @ua",
      "'+fingerprint",
      "' =cmd",
      "'-1",
      "plain value",
    ]) {
      expect(newLayoutRow.row).toContain(expectedCell);
    }
    expect(newLayoutRow.row).not.toContain("'plain value");

    const existingLayoutRow = mapRecordToSheetRow(
      record,
      newLayoutRow.idRow,
      sheetTitleMap,
      new Set(["=canvas"]),
      newLayoutRow.titleRow,
    );

    expect(existingLayoutRow.idRow).toEqual(newLayoutRow.idRow);
    expect(existingLayoutRow.titleRow).toEqual(newLayoutRow.titleRow);
    expect(existingLayoutRow.row).toEqual(newLayoutRow.row);
  });
});
