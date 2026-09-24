import swaggerJsdoc from "swagger-jsdoc";
import { z } from "zod";

import * as v from "../app/validation/schemas";
import {
  ACCOUNT_TYPES,
  BUDGET_PERIOD_TYPES,
  BUDGET_TYPES,
  CATEGORY_TYPES,
  COLORS,
  DEBT_ACCOUNT_FIELD_NAMES,
  DEBT_ACCOUNT_FIELDS,
  DebtAccountField,
  GROUP_SPLIT_MODES,
  GROUP_STATUSES,
  INVITATION_LIFETIME_DAYS,
  INVITATION_STATUSES,
  MAX_CONTACTS_PER_USER,
  MAX_EXPENSE_GUESTS,
  MAX_GROUP_PARTICIPANTS,
  MAX_PENDING_INVITATIONS_PER_USER,
  SETTLEMENT_PARTIES,
  SHARE_PARTIES,
  SHARED_HISTORY_REASONS,
  SPENDING_GROUP_BY,
  SPENDING_SPLIT_BY,
  SPLIT_MODES,
  TRANSACTION_SOURCES,
  TRANSACTION_TYPES,
} from "../shared/constants";
import { ZERO_DECIMAL_CURRENCIES } from "../shared/currency";
import { ERROR_CODES } from "../shared/errorCodes";
import { CATEGORY_ICONS } from "../shared/icons";
import { LOCALES } from "../shared/locale";
import {
  RESTAMPED_ENTITIES,
  SYNC_ENTITIES,
  SYNC_OP_STATUSES,
  SYNC_WARNINGS,
} from "../shared/syncBatch";
import { INCOME_REFUSED_ON } from "../shared/transactionRules";

// GENERATED from the Zod schemas: never hand-write a request schema here, edit schemas.ts.

const toJson = (schema: z.ZodType): Record<string, unknown> =>
  z.toJSONSchema(schema, {
    target: "openapi-3.0",
    io: "input",
    unrepresentable: "any",
    override: ({ jsonSchema }) => {
      // .datetime() emits a screen-long ISO regex; format is enough for docs.
      if (jsonSchema.format && jsonSchema.pattern) delete jsonSchema.pattern;
    },
  }) as Record<string, unknown>;

const bodyOf = (schema: z.ZodObject): Record<string, unknown> =>
  toJson((schema.shape as { body: z.ZodType }).body);

const requestBodies = {
  RegisterInput: bodyOf(v.registerSchema),
  LoginInput: bodyOf(v.loginSchema),
  RefreshInput: bodyOf(v.refreshSchema),
  UpdateUserInput: bodyOf(v.updateUserSchema),
  DeleteUserInput: bodyOf(v.deleteUserSchema),
  CreateAccountInput: bodyOf(v.createAccountSchema),
  UpdateAccountInput: bodyOf(v.updateAccountSchema),
  CreateCategoryInput: bodyOf(v.createCategorySchema),
  CreateContactInput: bodyOf(v.createContactSchema),
  UpdateContactInput: bodyOf(v.updateContactSchema),
  CreateSharedGroupInput: bodyOf(v.createSharedGroupSchema),
  UpdateSharedGroupInput: bodyOf(v.updateSharedGroupSchema),
  AddParticipantsInput: bodyOf(v.addParticipantsSchema),
  CreateSharedExpenseInput: bodyOf(v.createSharedExpenseSchema),
  CreateSettlementInput: bodyOf(v.createSettlementSchema),
  WriteOffInput: bodyOf(v.writeOffSchema),
  CreateInvitationInput: bodyOf(v.createInvitationSchema),
  AddToLedgerInput: bodyOf(v.addToLedgerSchema),
  UpdateSharedExpenseInput: bodyOf(v.updateSharedExpenseSchema),
  UpdateCategoryInput: bodyOf(v.updateCategorySchema),
  CreateTransactionInput: bodyOf(v.createTransactionSchema),
  UpdateTransactionInput: bodyOf(v.updateTransactionSchema),
  QuickAddTransactionInput: bodyOf(v.quickAddTransactionSchema),
  BatchUpdateTransactionsInput: bodyOf(v.batchUpdateTransactionsSchema),
  RestoreInput: bodyOf(v.restoreSchema),
  CreateBudgetInput: bodyOf(v.createBudgetSchema),
  UpdateBudgetInput: bodyOf(v.updateBudgetSchema),
  BudgetAmountOverrideInput: bodyOf(v.budgetAmountOverrideSchema),
  SyncBatchInput: bodyOf(v.syncBatchSchema),
};

// Hand-maintained mirrors of what the API serializes; enums come from constants.ts so they cannot drift.

const uuid = { type: "string", format: "uuid" };
const dateTime = { type: "string", format: "date-time" };
const nullableDateTime = { ...dateTime, nullable: true };
// Decimal money (the API speaks decimals; storage is integer cents).
const money = { type: "number" };
const enumOf = (values: Record<string, string>): object => ({
  type: "string",
  enum: Object.keys(values),
});
// Which types carry each optional debt amount; absent on every other type, and on one that never set it.
const debtFieldDescription = (field: DebtAccountField): string =>
  `Only on ${DEBT_ACCOUNT_FIELDS[field].join(" and ")} accounts, and only once set. Sending it on another type is 400 ACCOUNT_FIELD_NOT_FOR_TYPE; null on PUT clears it.`;

/**
 * Response views describe what the API *always* sends, so every property is
 * required unless it genuinely may be absent. Without this, generators like
 * openapi-typescript type the whole payload as optional and every consumer has
 * to null-check fields that are never missing.
 *
 * Derived from the properties rather than listed by hand: a new field is
 * required by default, which is the safe direction to forget.
 */
const withRequired = <T extends { properties: Record<string, unknown> }>(
  view: T,
  optional: readonly string[] = [],
): T & { required: string[] } => ({
  ...view,
  required: Object.keys(view.properties).filter((k) => !optional.includes(k)),
});

const without = (
  properties: Record<string, unknown>,
  drop: readonly string[],
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(properties).filter(([key]) => !drop.includes(key)),
  );

const restamped = {
  type: "array",
  items: { $ref: "#/components/schemas/Restamp" },
  description:
    "The other rows this write rewrote, empty when it touched none. A queued " +
    "write on one of them guarded by `previousUpdatedAt` may be guarded by " +
    "`updatedAt` instead: nothing else moved it in between.",
};

const withRestamps = (view: string): Record<string, unknown> => ({
  allOf: [
    { $ref: `#/components/schemas/${view}` },
    {
      type: "object",
      properties: { restamped },
      required: ["restamped"],
    },
  ],
});

const responseViews = {
  ErrorResponse: {
    type: "object",
    properties: {
      error: { type: "string", example: "NotFoundError" },
      message: { type: "string" },
      code: {
        type: "string",
        enum: [...ERROR_CODES],
        description:
          "Stable machine-readable code. Branch on this, never on message.",
      },
      details: {
        type: "array",
        items: {
          type: "object",
          properties: {
            field: { type: "string" },
            message: { type: "string" },
          },
        },
      },
    },
    required: ["error", "message"],
  },
  Message: withRequired({
    type: "object",
    properties: { message: { type: "string" } },
  }),
  Restamp: withRequired({
    type: "object",
    description:
      "A row a write rewrote besides the one it answers: an expense whose " +
      "split was imputed again, a movement whose figure or history moved, " +
      "an account whose balance a movement moved or whose default was taken.",
    properties: {
      entity: { type: "string", enum: [...RESTAMPED_ENTITIES] },
      id: uuid,
      previousUpdatedAt: dateTime,
      updatedAt: dateTime,
    },
  }),
  AccountWithRestamps: withRestamps("Account"),
  TransactionWithRestamps: withRestamps("Transaction"),
  MessageWithRestamps: withRestamps("Message"),
  SharedExpenseWithRestamps: withRestamps("SharedExpense"),
  SharedGroupWithRestamps: withRestamps("SharedGroup"),
  SettlementWithRestamps: withRestamps("Settlement"),
  Pagination: withRequired({
    type: "object",
    properties: {
      limit: { type: "integer" },
      offset: { type: "integer" },
      total: { type: "integer" },
      hasMore: { type: "boolean" },
      nextCursor: { ...uuid, nullable: true },
    },
  }),
  User: withRequired(
    {
      type: "object",
      properties: {
        id: uuid,
        name: { type: "string" },
        email: { type: "string", format: "email" },
        timezone: { type: "string", example: "America/Bogota" },
        currency: { type: "string", example: "COP" },
        locale: { ...enumOf(LOCALES), example: "en" },
        lastLoginAt: nullableDateTime,
        createdAt: dateTime,
        updatedAt: dateTime,
        reactivated: {
          type: "boolean",
          description:
            "Present (true) only when register revived a soft-deleted account.",
        },
      },
    },
    ["reactivated"],
  ),
  AuthTokens: withRequired(
    {
      type: "object",
      properties: {
        accessToken: { type: "string" },
        refreshToken: { type: "string" },
        user: { $ref: "#/components/schemas/User" },
        deviceToken: {
          type: "string",
          description:
            "Login and register only. Proof that this device already signed in to this email: send it back as `deviceToken` on the next login or register and its failed attempts get a budget of their own, so a stranger's failures cannot lock this device out. Keep it across logouts, and keep the new one each login or register answers. A password or email change and a logout-all revoke every device token issued before.",
        },
      },
      required: ["accessToken", "refreshToken"],
    },
    ["user", "deviceToken"],
  ),
  Session: withRequired(
    {
      type: "object",
      description: "One logged-in device (refresh-token rotation family).",
      properties: {
        id: uuid,
        createdAt: dateTime,
        lastUsedAt: dateTime,
        expiresAt: dateTime,
        userAgent: { type: "string" },
        current: {
          type: "boolean",
          description:
            "True for the session the requesting access token belongs to (this device).",
        },
      },
    },
    ["userAgent"],
  ),
  Account: withRequired(
    {
      type: "object",
      properties: {
        id: uuid,
        name: { type: "string" },
        type: enumOf(ACCOUNT_TYPES),
        balance: money,
        openingBalance: money,
        color: { ...enumOf(COLORS), nullable: true },
        creditLimit: {
          ...money,
          description: debtFieldDescription("creditLimit"),
        },
        borrowedAmount: {
          ...money,
          description: debtFieldDescription("borrowedAmount"),
        },
        userId: uuid,
        isDefault: { type: "boolean" },
        currency: { type: "string", example: "COP" },
        archivedAt: nullableDateTime,
        createdAt: dateTime,
        updatedAt: dateTime,
      },
    },
    DEBT_ACCOUNT_FIELD_NAMES,
  ),
  Category: withRequired(
    {
      type: "object",
      properties: {
        id: uuid,
        name: { type: "string" },
        icon: {
          type: "string",
          enum: [...CATEGORY_ICONS],
          nullable: true,
          description: "Lucide icon key from the curated set",
          example: "utensils",
        },
        color: { ...enumOf(COLORS), nullable: true },
        type: { ...enumOf(CATEGORY_TYPES), nullable: true },
        userId: uuid,
        seedKey: {
          type: "string",
          description: "Stable identity of a seeded default category.",
        },
        archivedAt: nullableDateTime,
        createdAt: dateTime,
        updatedAt: dateTime,
      },
    },
    ["seedKey"],
  ),
  Contact: withRequired(
    {
      type: "object",
      description:
        "A person you split expenses with. Not an account: no balance, no type, no limit, and never part of what you have or what you owe.",
      properties: {
        id: uuid,
        name: { type: "string" },
        color: { ...enumOf(COLORS), nullable: true },
        email: {
          type: "string",
          format: "email",
          description:
            "What an invitation to a shared group is addressed to; nothing is emailed from this API, and two contacts may carry the same address. Changing it withdraws the contact's waiting invitations.",
        },
        userId: uuid,
        archivedAt: nullableDateTime,
        createdAt: dateTime,
        updatedAt: dateTime,
      },
    },
    ["email", "color"],
  ),
  SharedGroupParticipant: withRequired({
    type: "object",
    properties: {
      contactId: {
        ...uuid,
        nullable: true,
        description:
          "null is you: the owner is a row of the group like anybody else.",
      },
      addedAt: dateTime,
    },
  }),
  DefaultSplit: withRequired({
    type: "object",
    description:
      "The split a new expense inherits, not a rule. EQUAL or PERCENT only: a default has no total to divide. Changing it is never retroactive.",
    properties: {
      mode: enumOf(GROUP_SPLIT_MODES),
      shares: {
        type: "array",
        description:
          "PERCENT only, one entry per participant adding up to 100; empty under EQUAL.",
        items: withRequired({
          type: "object",
          properties: {
            contactId: { ...uuid, nullable: true },
            percent: { type: "number" },
          },
        }),
      },
    },
  }),
  SharedShare: withRequired({
    type: "object",
    description:
      "One party of a split. GUESTS is the block whose head count sits in `guests`; it weighs that many parts and is one party to collect from.",
    properties: {
      party: enumOf(SHARE_PARTIES),
      contactId: { ...uuid, nullable: true },
      percent: {
        type: "number",
        nullable: true,
        description: "PERCENT only.",
      },
      fixedAmount: {
        ...money,
        nullable: true,
        description: "EXACT always; FIXED_REST only on a pinned share.",
      },
      amount: {
        ...money,
        description:
          "What the split resolved to. The shares always add up to the expense: the odd minor unit goes to whoever paid.",
      },
      collected: {
        ...money,
        description:
          "How much of this share has been settled. Never typed: it is the imputation of the live payments, rewritten by every write that touches a split or a payment.",
      },
    },
  }),
  SharedSplit: withRequired({
    type: "object",
    properties: {
      mode: enumOf(SPLIT_MODES),
      guests: {
        type: "object",
        nullable: true,
        description:
          "Guests belong to this expense alone: they are not contacts, they are not in the group, and they go when the expense goes.",
        properties: {
          count: { type: "integer" },
          name: { type: "string", nullable: true },
        },
        required: ["count", "name"],
      },
      shares: {
        type: "array",
        items: { $ref: "#/components/schemas/SharedShare" },
      },
    },
  }),
  SharedGroupTotals: withRequired({
    type: "object",
    description:
      "Derived from the group's live expenses on every read, never stored. A group has no period: the range is its expenses'.",
    properties: {
      amount: money,
      yourShare: money,
      owedToYou: {
        ...money,
        description:
          "What people still owe you for the lines you fronted, written-off amounts aside.",
      },
      writtenOff: {
        ...money,
        description:
          "What you have given up on here. It stopped being owed and was always counted as yours.",
      },
      youOwe: {
        ...money,
        description:
          "Your share of the lines somebody else fronted, still unpaid.",
      },
      collected: {
        ...money,
        description: "What has already come back to you here.",
      },
      expenseCount: { type: "integer" },
      dateFrom: nullableDateTime,
      dateTo: nullableDateTime,
    },
  }),
  SharedGroup: withRequired(
    {
      type: "object",
      description:
        "An outing, a dinner or a two-month trip. It has no month of its own.",
      properties: {
        id: uuid,
        name: { type: "string" },
        color: { ...enumOf(COLORS), nullable: true },
        participants: {
          type: "array",
          items: { $ref: "#/components/schemas/SharedGroupParticipant" },
        },
        defaultSplit: { $ref: "#/components/schemas/DefaultSplit" },
        writeOffs: {
          type: "array",
          description:
            "Who you have given up on here, and when. It moves no figure: that money was counted as yours the day it left.",
          items: withRequired({
            type: "object",
            properties: {
              kind: enumOf(SETTLEMENT_PARTIES),
              contactId: { ...uuid, nullable: true },
              expenseId: {
                ...uuid,
                nullable: true,
                description: "GUESTS only: the expense the block lives in.",
              },
              amount: {
                ...money,
                description:
                  "What was open when it was decided: the ceiling of what is given up, never a figure that moves.",
              },
              at: dateTime,
            },
          }),
        },
        userId: uuid,
        currency: { type: "string", example: "COP" },
        totals: { $ref: "#/components/schemas/SharedGroupTotals" },
        status: {
          ...enumOf(GROUP_STATUSES),
          description:
            "Derived: SETTLED once nobody owes anything here, by paying or by being written off.",
        },
        archivedAt: nullableDateTime,
        createdAt: dateTime,
        updatedAt: dateTime,
      },
    },
    ["color"],
  ),
  SharedExpense: withRequired({
    type: "object",
    properties: {
      id: uuid,
      groupId: uuid,
      description: { type: "string", nullable: true },
      date: dateTime,
      amount: { ...money, description: "What the expense cost, in full." },
      paidByContactId: {
        ...uuid,
        nullable: true,
        description:
          "Who fronted the money; null is you. Somebody else's line is not your expense until you settle with them.",
      },
      split: { $ref: "#/components/schemas/SharedSplit" },
      customSplit: {
        type: "boolean",
        description:
          "True once a split is saved on this expense; cleared by going back to the group's default.",
      },
      userId: uuid,
      currency: { type: "string", example: "COP" },
      deletedAt: nullableDateTime,
      createdAt: dateTime,
      updatedAt: dateTime,
    },
  }),
  JoinedParticipant: withRequired({
    type: "object",
    properties: {
      contactId: {
        ...uuid,
        nullable: true,
        description:
          "null is the person who shared the group, as in their own rows: `paidByContactId: null` and a USER share are theirs.",
      },
      name: {
        type: "string",
        description:
          "The name on their own profile for the person who shared the group and for anybody who joined it; the name the owner gave them otherwise.",
      },
      color: { ...enumOf(COLORS), nullable: true },
      you: { type: "boolean" },
      joined: { type: "boolean" },
    },
  }),
  JoinedGroup: withRequired({
    type: "object",
    description:
      "A group somebody else shared with you, read-only: its people, its default split and who was written off. Nothing of anybody's ledger — no account, category, note or what counts as the owner's. `updatedAt` is when anything here last changed for you, or when you joined, whichever is later.",
    properties: {
      id: uuid,
      invitationId: {
        ...uuid,
        description: "The invitation you joined with: leaving goes through it.",
      },
      name: { type: "string" },
      color: { ...enumOf(COLORS), nullable: true },
      currency: { type: "string", example: "COP" },
      ownerId: {
        ...uuid,
        description:
          "Who shared it: the same for every group of theirs, so their groups can be told apart from another person's with the same name.",
      },
      ownerName: { type: "string" },
      participants: {
        type: "array",
        items: { $ref: "#/components/schemas/JoinedParticipant" },
      },
      defaultSplit: { $ref: "#/components/schemas/DefaultSplit" },
      writeOffs: {
        type: "array",
        items: withRequired({
          type: "object",
          properties: {
            kind: enumOf(SETTLEMENT_PARTIES),
            contactId: { ...uuid, nullable: true },
            expenseId: { ...uuid, nullable: true },
            amount: money,
            at: dateTime,
          },
        }),
      },
      archivedAt: nullableDateTime,
      createdAt: dateTime,
      updatedAt: dateTime,
    },
  }),
  JoinedExpense: withRequired({
    type: "object",
    description:
      "A line of a group shared with you, exactly as its owner keeps it, minus who owns it. Your part is the CONTACT share named by your participant row; it reads paid once its `collected` reaches its `amount`.",
    properties: {
      id: uuid,
      groupId: uuid,
      description: { type: "string", nullable: true },
      date: dateTime,
      amount: money,
      paidByContactId: {
        ...uuid,
        nullable: true,
        description: "null is the person who shared the group.",
      },
      split: { $ref: "#/components/schemas/SharedSplit" },
      customSplit: { type: "boolean" },
      currency: { type: "string", example: "COP" },
      deletedAt: nullableDateTime,
      createdAt: dateTime,
      updatedAt: dateTime,
    },
  }),
  AddParticipantsPreview: withRequired({
    type: "object",
    description:
      "What adding people would do, worked out and thrown away. What each person has already paid, who ends up ahead of what they owe and what a written-off amount becomes are not here yet: none of it exists on the server until payments and write-offs do.",
    properties: {
      participants: {
        type: "array",
        items: withRequired({
          type: "object",
          properties: {
            contactId: { ...uuid, nullable: true },
            shareBefore: money,
            shareAfter: money,
          },
        }),
      },
      expenses: withRequired({
        type: "object",
        properties: {
          total: { type: "integer" },
          resplit: { type: "integer" },
          untouched: {
            type: "integer",
            description:
              "Expenses carrying their own PERCENT or EXACT split: a figure for somebody who was not there would be invented, so they are left alone.",
          },
        },
      }),
    },
  }),
  AddParticipantsResult: withRequired({
    type: "object",
    properties: {
      group: { $ref: "#/components/schemas/SharedGroup" },
      applied: { $ref: "#/components/schemas/AddParticipantsPreview" },
      restamped,
    },
  }),
  SentInvitation: withRequired({
    type: "object",
    description:
      "An invitation to one of your groups, as the inviter reads it: who it was addressed to and how it stands. It never says whether the address has an account, nor who answered. A PENDING one past `expiresAt` can no longer be answered — nothing on the server marks that moment, so it is read from the date.",
    properties: {
      id: uuid,
      groupId: uuid,
      contactId: uuid,
      email: { type: "string", format: "email" },
      status: enumOf(INVITATION_STATUSES),
      expiresAt: dateTime,
      answeredAt: nullableDateTime,
      withdrawnAt: {
        ...nullableDateTime,
        description:
          "Set when it was withdrawn, or when a joined person stopped being shared with: by you, by taking them out of the group or archiving their contact, or by deleting your account. Archiving the group or changing their email ends only one still waiting.",
      },
      leftAt: {
        ...nullableDateTime,
        description:
          "Set when the person who joined left the group themselves (status LEFT), or deleted their account.",
      },
      createdAt: dateTime,
      updatedAt: dateTime,
    },
  }),
  ReceivedInvitation: withRequired({
    type: "object",
    description:
      "An invitation to somebody else's group, as the invited person reads it: the group's name, colour and currency as they are now, and who sent it — nothing else of the group before joining. A PENDING one past `expiresAt` can no longer be answered.",
    properties: {
      id: uuid,
      groupId: uuid,
      groupName: { type: "string" },
      groupColor: { ...enumOf(COLORS), nullable: true },
      groupCurrency: {
        type: "string",
        example: "COP",
        description:
          "A group in a currency other than yours can only be declined (CURRENCY_MISMATCH).",
      },
      inviterName: {
        type: "string",
        description: "The sender's profile name when it was sent.",
      },
      inviterEmail: { type: "string", format: "email" },
      status: enumOf(INVITATION_STATUSES),
      expiresAt: dateTime,
      answeredAt: nullableDateTime,
      leftAt: {
        ...nullableDateTime,
        description: "Set when you left the group (status LEFT).",
      },
      createdAt: dateTime,
      updatedAt: dateTime,
    },
  }),
  Settlement: withRequired({
    type: "object",
    description:
      "Money that changed hands with one person, or with the block of guests " +
      "of one expense. It carries no account and no category: those are " +
      "yours, and what everybody in a group can see is that it was paid.",
    properties: {
      id: uuid,
      userId: uuid,
      counterparty: withRequired({
        type: "object",
        properties: {
          kind: enumOf(SETTLEMENT_PARTIES),
          contactId: { ...uuid, nullable: true },
          expenseId: {
            ...uuid,
            nullable: true,
            description: "GUESTS only: the expense the block lives in.",
          },
        },
      }),
      date: dateTime,
      collected: { ...money, description: "What came back to you." },
      paid: { ...money, description: "What you handed over." },
      outsideApp: {
        type: "boolean",
        description:
          "Cash the app never saw: no movement was written and no balance moved.",
      },
      currency: { type: "string", example: "COP" },
      deletedAt: {
        ...nullableDateTime,
        description:
          "Set when the payment was undone. A read never answers one, but the " +
          "change feed does: it is how a device learns the payment is gone.",
      },
      createdAt: dateTime,
      updatedAt: dateTime,
    },
  }),
  SettlementCoverage: withRequired({
    type: "object",
    properties: {
      expenseId: uuid,
      description: { type: "string", nullable: true },
      date: dateTime,
      amount: money,
      direction: {
        type: "string",
        enum: ["COLLECTED", "PAID"],
        description:
          "COLLECTED came off what that line still counts as yours; PAID is a line of theirs you covered.",
      },
    },
  }),
  SettlementResult: withRequired({
    type: "object",
    properties: {
      settlement: { $ref: "#/components/schemas/Settlement" },
      covered: {
        type: "array",
        items: { $ref: "#/components/schemas/SettlementCoverage" },
        description: "Oldest line first, which is the order it was imputed in.",
      },
      refunded: {
        ...money,
        description:
          "What you handed over that covered no line: their money going back to them.",
      },
      restamped,
    },
  }),
  Transaction: withRequired({
    type: "object",
    properties: {
      id: uuid,
      type: enumOf(TRANSACTION_TYPES),
      amount: money,
      date: dateTime,
      dayKey: {
        type: "string",
        nullable: true,
        example: "2026-09-30",
        description:
          "The local accounting day of `date` in the account's time zone, " +
          "frozen when the transaction was written: a later change of that " +
          "zone cannot move it to another day, month or budget period. Null " +
          "only on rows written before the field existed.",
      },
      categoryId: { ...uuid, nullable: true },
      description: { type: "string", nullable: true },
      fromAccountId: { ...uuid, nullable: true },
      toAccountId: { ...uuid, nullable: true },
      userId: uuid,
      tags: { type: "array", items: { type: "string" } },
      note: { type: "string", nullable: true },
      pendingDetails: { type: "boolean" },
      source: {
        ...enumOf(TRANSACTION_SOURCES),
        description: "Server-derived; quick-add stamps QUICK.",
      },
      currency: { type: "string", example: "COP" },
      countsAsYours: {
        ...money,
        description:
          "What the movement counts as yours: what left the account minus " +
          "what has come back. **This is the figure Stats and the budgets " +
          "measure**, and it is the amount itself unless the movement is an " +
          "expense of a shared group. The list, its day totals and " +
          "`summary.totalAmount` stay gross: they are what moved through the " +
          "accounts.",
      },
      sharedExpenseId: {
        ...uuid,
        nullable: true,
        description:
          "The expense of a shared group this movement is, or null. The link " +
          "lives here and not on the expense: a shared group is seen by " +
          "everybody in it, and which movement of yours it is nobody else's.",
      },
      sharedGroupId: { ...uuid, nullable: true },
      sharedSettlementId: {
        ...uuid,
        nullable: true,
        description:
          "The settle-up that recorded this movement, or null. Its money belongs to that " +
          "payment: editing the amount, the date, the type or the accounts is 400 " +
          "SETTLEMENT_MOVEMENT_LOCKED, and so is deleting it — undo the payment instead.",
      },
      sharedHistory: {
        type: "array",
        items: { $ref: "#/components/schemas/SharedHistoryEntry" },
        description:
          "Why `countsAsYours` is what it is, oldest first. Empty on a " +
          "movement that was never split.",
      },
      importedFromGroupId: {
        ...uuid,
        nullable: true,
        description:
          "The group shared with you this expense was added from with Add to " +
          "my ledger, or null. It is an ordinary expense of yours: its whole " +
          "amount counts as yours, and deleting it makes that line ready to " +
          "add again.",
      },
      importedFromExpenseId: {
        ...uuid,
        nullable: true,
        description:
          "The line of that group whose share of yours this is. One line " +
          "reaches your ledger once (SHARED_LINE_IN_LEDGER).",
      },
      createdAt: dateTime,
      updatedAt: dateTime,
    },
  }),
  SharedHistoryEntry: withRequired({
    type: "object",
    description:
      "One thing that happened to what counts as yours. Splitting an expense " +
      "and editing its split move no money — it left the account when it was " +
      "spent — so those entries repeat the figure rather than change it.",
    properties: {
      at: dateTime,
      reason: enumOf(SHARED_HISTORY_REASONS),
      countsAsYours: { ...money, description: "The figure it left behind." },
    },
  }),
  Budget: withRequired({
    type: "object",
    properties: {
      id: uuid,
      name: { type: "string" },
      color: enumOf(COLORS),
      categoryIds: {
        type: "array",
        items: uuid,
        description: "Empty array = global budget (all spending counts).",
      },
      archivedCategoryIds: {
        type: "array",
        items: uuid,
        description: "Subset of categoryIds the user archived.",
      },
      type: enumOf(BUDGET_TYPES),
      currency: { type: "string", example: "COP" },
      periodType: enumOf(BUDGET_PERIOD_TYPES),
      periodKey: { type: "string" },
      periodFrom: dateTime,
      periodTo: dateTime,
      baseAmount: money,
      amount: {
        ...money,
        description: "Resolved for the period: override ?? baseAmount.",
      },
      spent: money,
      hasOverride: { type: "boolean" },
      expired: {
        type: "boolean",
        description: "CUSTOM only: the fixed window already ended.",
      },
      effectiveFrom: dateTime,
      note: { type: "string", nullable: true },
      archivedAt: nullableDateTime,
      createdAt: dateTime,
      updatedAt: dateTime,
    },
  }),
  BatchUpdateFailure: withRequired({
    type: "object",
    properties: {
      id: uuid,
      code: { type: "string", enum: [...ERROR_CODES] },
      message: { type: "string" },
    },
  }),
  BatchUpdateResult: withRequired({
    type: "object",
    description:
      "Per-item outcome. The status is 200 even when some items failed: read `failed`.",
    properties: {
      updated: {
        type: "array",
        items: { $ref: "#/components/schemas/Transaction" },
      },
      failed: {
        type: "array",
        items: { $ref: "#/components/schemas/BatchUpdateFailure" },
      },
    },
  }),
  StatsSplit: withRequired({
    type: "object",
    description: "One category inside a bucket, when splitBy asked for them.",
    properties: {
      key: {
        type: "string",
        description: "Category id, or 'uncategorized'.",
      },
      total: money,
      count: { type: "integer" },
      avg: money,
    },
  }),
  StatsBucket: withRequired(
    {
      type: "object",
      properties: {
        key: {
          type: "string",
          description:
            "Category id, day (YYYY-MM-DD), month (YYYY-MM), account id or tag; " +
            "'uncategorized' and 'untagged' for the catch-all buckets, and " +
            "'unassigned' for a row with no account at all, which validation no longer allows.",
        },
        total: money,
        count: { type: "integer" },
        avg: money,
        splits: {
          type: "array",
          items: { $ref: "#/components/schemas/StatsSplit" },
          description:
            "Present only when splitBy was given. The splits of a bucket add " +
            "up to its own total: no row lands in two of them.",
        },
      },
    },
    ["splits"],
  ),
  StatsResponse: withRequired({
    type: "object",
    properties: {
      groupBy: enumOf(SPENDING_GROUP_BY),
      splitBy: {
        ...enumOf(SPENDING_SPLIT_BY),
        nullable: true,
        description: "The second dimension asked for, or null.",
      },
      buckets: {
        type: "array",
        items: { $ref: "#/components/schemas/StatsBucket" },
      },
      total: {
        ...money,
        description:
          "Real total without double counting (multi-tag buckets can sum higher).",
      },
    },
  }),
};

// Separate because SyncTransaction derives from the Transaction view and cannot read it yet.
const syncViews = {
  SyncTransaction: withRequired({
    type: "object",
    description:
      "A transaction in the change feed: the usual shape plus the tombstone.",
    properties: {
      ...responseViews.Transaction.properties,
      deletedAt: {
        ...nullableDateTime,
        description:
          "Set when the transaction was deleted. Only the sync feed reports " +
          "it: everywhere else a deleted transaction simply stops existing.",
      },
    },
  }),
  SyncSharedGroup: withRequired(
    {
      type: "object",
      description:
        "A group as STORED, not the view GET /shared-groups returns: no " +
        "totals and no status. Both are worked out from the group's expenses " +
        "on every read, and the client already holds the expenses.",
      properties: without(responseViews.SharedGroup.properties, [
        "totals",
        "status",
      ]),
    },
    ["color"],
  ),
  SyncBudget: withRequired({
    type: "object",
    description:
      "A budget as STORED, not the view GET /budgets returns: no periodKey, " +
      "no window and no spent. Those depend on a reference date and on the " +
      "transactions, so the client derives them from what it already holds.",
    properties: {
      id: uuid,
      name: { type: "string" },
      color: enumOf(COLORS),
      categoryIds: {
        type: "array",
        items: uuid,
        description: "Empty array = global budget (all spending counts).",
      },
      type: enumOf(BUDGET_TYPES),
      currency: { type: "string", example: "COP" },
      amount: { ...money, description: "Base amount, before any override." },
      amountOverrides: {
        type: "object",
        additionalProperties: money,
        description: 'Period key (e.g. "2026-12") to the amount for it.',
      },
      periodType: enumOf(BUDGET_PERIOD_TYPES),
      periodStartDate: nullableDateTime,
      periodEndDate: nullableDateTime,
      effectiveFrom: nullableDateTime,
      note: { type: "string", nullable: true },
      userId: uuid,
      archivedAt: nullableDateTime,
      createdAt: dateTime,
      updatedAt: dateTime,
    },
  }),
};

const listOf = (ref: string): object =>
  withRequired({
    type: "object",
    properties: {
      data: { type: "array", items: { $ref: `#/components/schemas/${ref}` } },
      pagination: { $ref: "#/components/schemas/Pagination" },
    },
  });

/** Envelope for the endpoints that return a whole set, with no pagination. */
const dataOf = (items: object): object =>
  withRequired({
    type: "object",
    properties: { data: { type: "array", items } },
  });

/**
 * The change feed's envelope. `nextCursor` is never null: a finished run still
 * hands back the watermark for the next one (60 s behind `serverTime`, see the
 * route's description).
 */
const syncChangesResponse = withRequired({
  type: "object",
  properties: {
    serverTime: {
      ...dateTime,
      description: "The server's clock when the page was read.",
    },
    changes: withRequired({
      type: "object",
      properties: {
        user: {
          allOf: [{ $ref: "#/components/schemas/User" }],
          nullable: true,
          description: "Null when the profile did not change in this page.",
        },
        accounts: {
          type: "array",
          items: { $ref: "#/components/schemas/Account" },
        },
        categories: {
          type: "array",
          items: { $ref: "#/components/schemas/Category" },
        },
        transactions: {
          type: "array",
          items: { $ref: "#/components/schemas/SyncTransaction" },
        },
        budgets: {
          type: "array",
          items: { $ref: "#/components/schemas/SyncBudget" },
        },
        contacts: {
          type: "array",
          items: { $ref: "#/components/schemas/Contact" },
        },
        sharedGroups: {
          type: "array",
          items: { $ref: "#/components/schemas/SyncSharedGroup" },
        },
        sharedExpenses: {
          type: "array",
          // The expense's own view already carries its tombstone, so there is nothing to add.
          items: { $ref: "#/components/schemas/SharedExpense" },
        },
        settlements: {
          type: "array",
          // The payment's own view already carries its tombstone, like the expense's.
          items: { $ref: "#/components/schemas/Settlement" },
        },
        invitationsSent: {
          type: "array",
          items: { $ref: "#/components/schemas/SentInvitation" },
        },
        invitationsReceived: {
          type: "array",
          description:
            "Addressed to your email and answered by nobody yet, or answered by you: they keep arriving after they are answered, withdrawn or out of time, which is how a device learns they stopped waiting.",
          items: { $ref: "#/components/schemas/ReceivedInvitation" },
        },
        joinedGroups: {
          type: "array",
          description:
            "Groups somebody else shared with you. A group you joined after the cursor arrives whole, because its rows are placed at the moment you joined. When your invitation stops being ACCEPTED, drop the group and its lines.",
          items: { $ref: "#/components/schemas/JoinedGroup" },
        },
        joinedExpenses: {
          type: "array",
          items: { $ref: "#/components/schemas/JoinedExpense" },
        },
      },
    }),
    pagination: withRequired({
      type: "object",
      properties: {
        limit: { type: "integer" },
        count: {
          type: "integer",
          description: "Rows in this page, all entities together.",
        },
        hasMore: { type: "boolean" },
        nextCursor: {
          type: "string",
          description:
            "Opaque. Send it back verbatim: as `cursor` to keep paging while " +
            "`hasMore`, and as the starting `cursor` of the next pull once it " +
            "is false.",
        },
      },
    }),
  },
});

/** Any of the rows a `POST /sync` operation can be about or answered with. */
const anyRow = {
  oneOf: ["Account", "Category", "Transaction", "Budget"].map((view) => ({
    $ref: `#/components/schemas/${view}`,
  })),
};

/** One operation's outcome in a `POST /sync` batch. */
const syncOpResult = withRequired(
  {
    type: "object",
    properties: {
      opId: uuid,
      seq: { type: "integer" },
      entity: { type: "string", enum: [...SYNC_ENTITIES] },
      id: { ...uuid, description: "The entity the operation was about." },
      status: { type: "string", enum: [...SYNC_OP_STATUSES] },
      code: {
        type: "string",
        enum: [...ERROR_CODES],
        description:
          "conflict / rejected: the code the matching route would have answered.",
      },
      message: { type: "string" },
      details: responseViews.ErrorResponse.properties.details,
      current: {
        ...anyRow,
        description:
          "The row as the server has it, like the HTTP 409: STALE_UPDATE, a " +
          "DUPLICATE whose name an active row holds, and RESOURCE_ARCHIVED.",
      },
      result: {
        ...anyRow,
        description:
          "applied, merged, and duplicate by client-minted id: what the route " +
          "would have answered. Absent for transaction:delete and for a " +
          "duplicate opId.",
      },
      blockedBy: {
        ...uuid,
        description:
          "blocked only: the opId, in this batch, whose failure blocks this one.",
      },
      mergedInto: {
        ...uuid,
        description:
          "merged (and a resent merged opId): the server row this operation " +
          "landed on instead of `id`. Later operations of the same batch that " +
          "name `id` are applied against it.",
      },
      warnings: {
        type: "array",
        items: { type: "string", enum: [...SYNC_WARNINGS] },
        description:
          "The write landed, but not as it was sent: " +
          "CATEGORY_ARCHIVED_DROPPED — the category was archived online, so " +
          "the movement was saved without it and flagged pendingDetails.",
      },
      restamped: {
        ...restamped,
        description:
          "On the writes whose route answers `restamped`: the same list, " +
          "lifted out of `result`, and kept with the opId so a resent one " +
          "answered `duplicate` carries it again. " +
          "Later operations of the same batch guarded by a `previousUpdatedAt` " +
          "here were already run against its `updatedAt`.",
      },
    },
  },
  [
    "code",
    "message",
    "details",
    "current",
    "result",
    "blockedBy",
    "mergedInto",
    "warnings",
    "restamped",
  ],
);

const syncBatchResponse = withRequired({
  type: "object",
  properties: {
    serverTime: {
      ...dateTime,
      description: "The server's clock when the batch started.",
    },
    results: {
      type: "array",
      items: { $ref: "#/components/schemas/SyncOpResult" },
      description: "One per operation, in `seq` order.",
    },
  },
});

/**
 * The 409 of a guarded write: the error, plus the resource as the server has it
 * when the code is STALE_UPDATE. Optional, because the same status also covers
 * DUPLICATE and ID_TAKEN, which carry nothing.
 */
const incomeRefusedAccountType = {
  type: "string",
  enum: [...INCOME_REFUSED_ON],
  description:
    "The account types an INCOME may not land on: money arriving at one of them is a payment, not income. A transaction whose type is INCOME and whose destination account has one of these types is rejected with 400 INCOME_ON_CARD_OR_LOAN; record a TRANSFER from the account the money came from, or an ADJUSTMENT when it came from outside. OVERDRAFT is deliberately absent — it is the account that holds the money and sometimes dips below zero, so a salary landing there is income.",
};

const zeroDecimalCurrency = {
  type: "string",
  enum: [...ZERO_DECIMAL_CURRENCIES],
  description:
    "The currencies this API stores with no minor unit. An amount carrying decimals in one of them is rejected with 400 AMOUNT_PRECISION wherever one is written: a transaction, an account balance, a credit limit or a borrowed amount, a budget amount and a budget period override, through the /sync batch as well as through these routes. It is judged on the amount a request carries, never on one already stored, so a row written before a currency joined this list stays editable in everything but its amount. Read this list instead of copying it; a client that keeps its own can refuse what the server takes, or offer what the server refuses. The ISO three-decimal currencies are absent on purpose: storage is integer cents, so they are capped at two.",
};

const sharedLimits = {
  type: "object",
  description:
    "The explicit ceilings of the shared-expenses section. Read them instead of copying the numbers: the sheet that adds a contact is meant to name the limit before a save can fail on it, and a client that keeps its own copy will eventually say a different one from the server.",
  properties: {
    maxContactsPerUser: {
      type: "integer",
      enum: [MAX_CONTACTS_PER_USER],
      description:
        "Active contacts one user may have. Creating or restoring past it is 400 CONTACT_LIMIT_REACHED.",
    },
    maxParticipantsPerGroup: {
      type: "integer",
      enum: [MAX_GROUP_PARTICIPANTS],
      description:
        "People in one shared group, the owner included. Adding past it is 400 PARTICIPANT_LIMIT_REACHED.",
    },
    maxPendingInvitationsPerUser: {
      type: "integer",
      enum: [MAX_PENDING_INVITATIONS_PER_USER],
      description:
        "Invitations one user may have waiting at once. Inviting past it is 400 INVITATION_LIMIT_REACHED.",
    },
    invitationLifetimeDays: {
      type: "integer",
      enum: [INVITATION_LIFETIME_DAYS],
      description: "How long an invitation waits to be answered.",
    },
    maxGuestsPerExpense: {
      type: "integer",
      enum: [MAX_EXPENSE_GUESTS],
      description:
        "Heads one guest block may carry. A sanity bound on an integer field, not a product rule: the block is one row whatever it counts.",
    },
  },
  required: [
    "maxContactsPerUser",
    "maxParticipantsPerGroup",
    "maxGuestsPerExpense",
    "maxPendingInvitationsPerUser",
    "invitationLifetimeDays",
  ],
};

const conflictOf = (view: string): Record<string, unknown> => ({
  allOf: [
    { $ref: "#/components/schemas/ErrorResponse" },
    {
      type: "object",
      properties: { current: { $ref: `#/components/schemas/${view}` } },
    },
  ],
});

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.3",
    info: {
      title: "lag-money-manager API",
      version: "1.0.0",
      description:
        "REST API for personal money management. Amounts are decimals with " +
        "at most 2 decimal places (stored as integer cents). Every monetary " +
        "resource carries the user's `currency` (ISO 4217). Errors carry a " +
        "stable machine-readable `code`. Mutating a create twice is safe " +
        "with the `Idempotency-Key` header on POST /transactions[/quick]. " +
        "Creates accept a client-minted `id`; writes accept `If-Match: " +
        "<updatedAt ISO>` and answer 409 STALE_UPDATE with the server's copy " +
        "in `current`.",
    },
    servers: [{ url: "/", description: "Current server" }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
      parameters: {
        IfMatch: {
          in: "header",
          name: "If-Match",
          required: false,
          schema: { type: "string", format: "date-time" },
          description:
            "Optimistic concurrency: the `updatedAt` this client last read, " +
            "verbatim (ISO 8601 with a time and an offset). The write only " +
            "lands if the server still has that version; otherwise 409 " +
            "STALE_UPDATE, with the server's copy in `current`. Omit the " +
            "header to write unconditionally, as before.",
        },
      },
      schemas: {
        ...requestBodies,
        ...responseViews,
        ...syncViews,
        IncomeRefusedAccountType: incomeRefusedAccountType,
        ZeroDecimalCurrency: zeroDecimalCurrency,
        SharedLimits: sharedLimits,
        SyncChangesResponse: syncChangesResponse,
        SyncOpResult: syncOpResult,
        SyncBatchResponse: syncBatchResponse,
        AccountList: listOf("Account"),
        CategoryList: listOf("Category"),
        ContactList: listOf("Contact"),
        SharedGroupList: listOf("SharedGroup"),
        SharedExpenseList: listOf("SharedExpense"),
        TransactionList: {
          ...(listOf("Transaction") as Record<string, unknown>),
          properties: {
            data: {
              type: "array",
              items: { $ref: "#/components/schemas/Transaction" },
            },
            pagination: { $ref: "#/components/schemas/Pagination" },
            summary: {
              type: "object",
              description:
                "Only when includeSummary=true. Sums the whole filtered set, not the page.",
              properties: { totalAmount: money },
              required: ["totalAmount"],
            },
          },
        },
        BudgetList: listOf("Budget"),
        SessionList: dataOf({ $ref: "#/components/schemas/Session" }),
        TagList: dataOf({ type: "string" }),
        RestoreDefaultsResponse: dataOf({
          $ref: "#/components/schemas/Category",
        }),
        AccountConflict: conflictOf("Account"),
        CategoryConflict: conflictOf("Category"),
        ContactConflict: conflictOf("Contact"),
        SharedGroupConflict: conflictOf("SharedGroup"),
        SharedExpenseConflict: conflictOf("SharedExpense"),
        SettlementList: listOf("Settlement"),
        SentInvitationList: listOf("SentInvitation"),
        ReceivedInvitationList: listOf("ReceivedInvitation"),
        JoinedGroupList: listOf("JoinedGroup"),
        JoinedExpenseList: listOf("JoinedExpense"),
        TransactionConflict: conflictOf("Transaction"),
        BudgetConflict: conflictOf("Budget"),
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ["./src/app/routes/*.ts"],
};

export const swaggerSpec = swaggerJsdoc(options);
