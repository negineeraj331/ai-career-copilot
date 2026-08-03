-- Remove the foreign key from AuditLog.userId.
--
-- Why: `onDelete: SetNull` issues an UPDATE against AuditLog, which the
-- append-only trigger refuses — so deleting a user became impossible, breaking
-- the 30-day purge required by NFR-51. A `Cascade` would be worse: it would
-- silently erase the security trail of the account being removed.
--
-- userId stays as a plain nullable UUID column: a pseudonymous actor reference
-- that outlives the User row by design, which is exactly what docs/12 §8
-- describes. `actorRef` is therefore redundant and goes away.

-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_userId_fkey";

-- DropIndex
-- The BRIN index from the previous migration is dropped here, deliberately.
-- Prisma models indexes, so every future `migrate diff` regenerates this DROP
-- for any index the schema does not declare — and Prisma has no BRIN support.
-- Keeping it would mean fighting the tool on every schema change. The composite
-- B-tree indexes below still serve the time-range queries; BRIN was a size
-- optimisation that only pays off in the millions of rows, and can return as an
-- out-of-band migration when the table is actually that large.
DROP INDEX "AuditLog_createdAt_brin_idx";

-- AlterTable
ALTER TABLE "AuditLog" DROP COLUMN "actorRef";
