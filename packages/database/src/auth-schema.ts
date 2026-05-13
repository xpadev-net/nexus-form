import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

// ── User ────────────────────────────────────────────────────────────

export const user = mysqlTable("User", {
  id: varchar("id", { length: 191 }).primaryKey(),
  name: varchar("name", { length: 191 }),
  email: varchar("email", { length: 191 }).notNull().unique(),
  emailVerified: boolean("emailVerified").default(false).notNull(),
  image: varchar("image", { length: 191 }),
  role: varchar("role", { length: 50 }).default("user").notNull(),
  isSuspended: boolean("isSuspended").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

// ── Session ─────────────────────────────────────────────────────────

export const session = mysqlTable(
  "Session",
  {
    id: varchar("id", { length: 191 }).primaryKey(),
    token: varchar("token", { length: 191 }).notNull().unique(),
    userId: varchar("userId", { length: 191 })
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expiresAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: varchar("ipAddress", { length: 191 }),
    userAgent: text("userAgent"),
  },
  (table) => [index("Session_userId_idx").on(table.userId)],
);

// ── Account ─────────────────────────────────────────────────────────

export const account = mysqlTable(
  "Account",
  {
    id: varchar("id", { length: 191 }).primaryKey(),
    userId: varchar("userId", { length: 191 })
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    providerId: varchar("providerId", { length: 191 }).notNull(),
    accountId: varchar("accountId", { length: 191 }).notNull(),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
    refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
    idToken: text("idToken"),
    scope: varchar("scope", { length: 191 }),
    password: text("password"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("Account_providerId_accountId_key").on(
      table.providerId,
      table.accountId,
    ),
    index("Account_userId_idx").on(table.userId),
  ],
);

// ── Verification ────────────────────────────────────────────────────
// Better Auth verification table (stores OAuth state, email verification, etc.)

export const verificationToken = mysqlTable("VerificationToken", {
  id: varchar("id", { length: 191 }).primaryKey(),
  identifier: varchar("identifier", { length: 191 }).notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

// ── Relations ───────────────────────────────────────────────────────

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));
