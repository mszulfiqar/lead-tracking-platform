"use client";

/**
 * Operator-only create-client form.
 *
 * Rendering is not a security boundary: the server action behind this form
 * re-verifies the platform-operator allowlist for every submission. The form
 * only offers convenient client-side affordances (slug generation, field
 * errors, a pending state that blocks duplicate submissions) while the
 * provisioning service remains authoritative for validation and conflicts.
 *
 * The password exists only in this component's in-memory field state and in
 * the submitted request. It is never rendered in results, written to browser
 * storage, or included in URLs or error messages.
 */
import {
  useActionState,
  useState,
  type ReactNode,
} from "react";

import { createClientOrganization } from "../app/operator/actions";
import { generateOrganizationSlug } from "../lib/client-provisioning";
import {
  INITIAL_PASSWORD_MAX_LENGTH,
  INITIAL_PASSWORD_MIN_LENGTH,
} from "../lib/password-policy";
import {
  fieldErrorFor,
  initialProvisionClientState,
  summaryFor,
  type ProvisionClientFormField,
  type ProvisionClientSummary,
} from "../lib/provisioning-form";

const inputClassName =
  "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

const summaryToneClassName: Record<ProvisionClientSummary["tone"], string> = {
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  warning:
    "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
  error:
    "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
};

function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error: string | null;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
      ) : null}
      {error ? (
        <p
          id={`${htmlFor}-error`}
          role="alert"
          className="text-sm text-red-700 dark:text-red-300"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function ProvisionClientForm() {
  const [state, formAction, pending] = useActionState(
    createClientOrganization,
    initialProvisionClientState,
  );

  const [companyName, setCompanyName] = useState("");
  const [organizationSlug, setOrganizationSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [initialPassword, setInitialPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Clear every field after a verified success so the next client starts from
  // a clean slate (this also drops the password from component state). This
  // is an adjust-state-during-render, guarded by comparing against the last
  // handled action state, so it runs exactly once per completed submission.
  const [lastHandledState, setLastHandledState] = useState(state);
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state.status === "provisioned") {
      setCompanyName("");
      setOrganizationSlug("");
      setSlugEdited(false);
      setOwnerName("");
      setOwnerEmail("");
      setInitialPassword("");
      setConfirmPassword("");
    }
  }

  const summary = summaryFor(state);
  const errorFor = (field: ProvisionClientFormField) =>
    fieldErrorFor(state, field);
  const errorProps = (field: ProvisionClientFormField) => {
    const error = errorFor(field);
    return {
      "aria-invalid": error ? true : undefined,
      "aria-describedby": error ? `${field}-error` : undefined,
      className: inputClassName,
    } as const;
  };

  function handleCompanyNameChange(value: string) {
    setCompanyName(value);
    if (!slugEdited) {
      setOrganizationSlug(generateOrganizationSlug(value));
    }
  }

  function handleSlugChange(value: string) {
    setOrganizationSlug(value);
    // Clearing the field returns to automatic generation from the name.
    setSlugEdited(value.trim() !== "");
  }

  const companyNameError = errorFor("companyName");
  const slugError = errorFor("organizationSlug");
  const ownerNameError = errorFor("ownerName");
  const ownerEmailError = errorFor("ownerEmail");
  const initialPasswordError = errorFor("initialPassword");
  const confirmPasswordError = errorFor("confirmPassword");

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field label="Company name" htmlFor="companyName" error={companyNameError}>
        <input
          id="companyName"
          name="companyName"
          type="text"
          required
          maxLength={100}
          autoComplete="off"
          value={companyName}
          onChange={(event) => handleCompanyNameChange(event.target.value)}
          {...errorProps("companyName")}
        />
      </Field>

      <Field
        label="Workspace link (slug)"
        htmlFor="organizationSlug"
        hint="Generated from the company name. Edit it to give the client a different link; leave it empty to generate one from the name."
        error={slugError}
      >
        <input
          id="organizationSlug"
          name="organizationSlug"
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="company-name"
          value={organizationSlug}
          onChange={(event) => handleSlugChange(event.target.value)}
          {...errorProps("organizationSlug")}
        />
      </Field>

      <Field
        label="Client owner's name"
        htmlFor="ownerName"
        error={ownerNameError}
      >
        <input
          id="ownerName"
          name="ownerName"
          type="text"
          required
          maxLength={100}
          autoComplete="off"
          value={ownerName}
          onChange={(event) => setOwnerName(event.target.value)}
          {...errorProps("ownerName")}
        />
      </Field>

      <Field
        label="Client owner's email"
        htmlFor="ownerEmail"
        hint="This is the sign-in address the client will use."
        error={ownerEmailError}
      >
        <input
          id="ownerEmail"
          name="ownerEmail"
          type="email"
          required
          maxLength={254}
          autoComplete="off"
          value={ownerEmail}
          onChange={(event) => setOwnerEmail(event.target.value)}
          {...errorProps("ownerEmail")}
        />
      </Field>

      <Field
        label="Initial password"
        htmlFor="initialPassword"
        hint={`${INITIAL_PASSWORD_MIN_LENGTH}-${INITIAL_PASSWORD_MAX_LENGTH} characters. Hand it to the client owner directly; it is never shown again.`}
        error={initialPasswordError}
      >
        <input
          id="initialPassword"
          name="initialPassword"
          type="password"
          required
          minLength={INITIAL_PASSWORD_MIN_LENGTH}
          maxLength={INITIAL_PASSWORD_MAX_LENGTH}
          autoComplete="new-password"
          value={initialPassword}
          onChange={(event) => setInitialPassword(event.target.value)}
          {...errorProps("initialPassword")}
        />
      </Field>

      <Field
        label="Confirm initial password"
        htmlFor="confirmPassword"
        error={confirmPasswordError}
      >
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          required
          minLength={INITIAL_PASSWORD_MIN_LENGTH}
          maxLength={INITIAL_PASSWORD_MAX_LENGTH}
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          {...errorProps("confirmPassword")}
        />
      </Field>

      {summary ? (
        <div
          role={summary.tone === "success" ? "status" : "alert"}
          className={`rounded-lg border px-3 py-2 text-sm ${summaryToneClassName[summary.tone]}`}
        >
          <p className="font-medium">{summary.title}</p>
          <p className="mt-1">{summary.message}</p>
          {summary.manualRecoveryRequired ? (
            <p className="mt-2 font-medium">
              Setup is incomplete. Manual recovery is required before this
              client can be treated as onboarded — do not hand over credentials
              yet, and verify the records mentioned above before retrying.
            </p>
          ) : null}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 flex h-11 items-center justify-center rounded-full bg-foreground px-5 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-60 dark:hover:bg-[#ccc]"
      >
        {pending ? "Provisioning workspace…" : "Create client workspace"}
      </button>
    </form>
  );
}
