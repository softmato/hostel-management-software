/**
 * Loads every model in `packages/db/src/models` and describes how each
 * collection points at others — read from the schemas, not a hand-kept list, so
 * a model added later is covered without anyone remembering to add it.
 *
 * Shared by `audit-test-data.mjs` and `purge-test-data.mjs`. Needs the TS hook:
 * `node --experimental-transform-types --import ./scripts/register-ts-hook.mjs`.
 */
import mongoose from "mongoose";
import { readdir } from "node:fs/promises";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/*
 * The models do `import { Schema, model, models } from "mongoose"`. Mongoose is
 * CommonJS and Node's ESM loader cannot find `models` among its exports, so
 * every `mongoose` import is pointed at a shim re-exporting this file's own
 * copy — which also guarantees the models land on the connection the scripts use.
 */
function shimMongoose() {
  const shim = `import { createRequire } from "node:module";
const m = createRequire(${JSON.stringify(import.meta.url)})("mongoose");
export const { Schema, Types, model, models } = m;
export default m;`;
  const shimUrl = `data:text/javascript,${encodeURIComponent(shim)}`;

  register(
    `data:text/javascript,${encodeURIComponent(
      `export async function resolve(specifier, context, next) {
        return specifier === "mongoose" ? { shortCircuit: true, url: ${JSON.stringify(shimUrl)} } : next(specifier, context);
      }`,
    )}`,
  );
}

/** `ref` of a schema type, wherever Mongoose keeps it for scalars and arrays. */
function refOf(schemaType) {
  const ref =
    schemaType.options?.ref ??
    schemaType.embeddedSchemaType?.options?.ref ??
    schemaType.caster?.options?.ref;

  return typeof ref === "string" ? ref : null;
}

/** Every reference in a schema, subdocuments included. */
function referencesOf(schema, prefix = "") {
  const found = [];

  schema.eachPath((name, schemaType) => {
    const full = prefix + name;
    const leaf = name.split(".").pop();
    const isArray = schemaType.instance === "Array" || Boolean(schemaType.$isMongooseArray);
    let ref = refOf(schemaType);

    // A few collections name the field right but never declared the ref.
    if (!ref && (leaf === "hostelId" || leaf === "hostelIds")) ref = "Hostel";
    if (!ref && leaf === "userId") ref = "User";
    if (!ref && leaf === "residentId") ref = "Resident";

    if (ref) {
      found.push({ isArray, leaf, path: full, ref });
    }

    if (schemaType.schema) {
      found.push(...referencesOf(schemaType.schema, `${full}.`));
    }
  });

  return found;
}

/** Top-level string paths that identify a person without an id. */
function contactPathsOf(schema) {
  const found = [];

  schema.eachPath((name, schemaType) => {
    if (
      !name.includes(".") &&
      schemaType.instance === "String" &&
      /^(email|phone|contactEmail|contactPhone|ownerEmail|ownerPhone)$/i.test(name)
    ) {
      found.push(name);
    }
  });

  return found;
}

/**
 * @returns entries of `{ name, collection, refs, userPaths, hostelRef, contactPaths }`.
 * `hostelRef` is the path that scopes a row to one hostel (`_id` for `Hostel`).
 */
export async function loadModelCatalogue() {
  shimMongoose();

  const modelsDir = path.join(repoRoot, "packages/db/src/models");

  for (const file of (await readdir(modelsDir)).filter((name) => name.endsWith(".ts")).sort()) {
    await import(pathToFileURL(path.join(modelsDir, file)).href);
  }

  return Object.values(mongoose.models)
    .map((model) => {
      const refs = referencesOf(model.schema);
      // Only `hostelId` / `hostelIds` scope a row. `lastSharedWithHostelId` and
      // its kind merely mention a hostel on a row that belongs to someone else.
      const hostelRef =
        model.modelName === "Hostel"
          ? { isArray: false, path: "_id" }
          : (refs.find((ref) => ref.path === "hostelId") ?? refs.find((ref) => ref.path === "hostelIds") ?? null);

      return {
        collection: model.collection.collectionName,
        contactPaths: contactPathsOf(model.schema),
        hostelRef,
        name: model.modelName,
        refs,
        userPaths: refs.filter((ref) => ref.ref === "User"),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export { repoRoot };
