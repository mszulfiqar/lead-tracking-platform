# Product Specification

## 1. Product Overview

Build a multi-tenant Speed-to-Lead SaaS platform for HVAC businesses in the United States.

The platform helps HVAC companies respond to incoming leads quickly, follow up consistently, and convert more inquiries into booked appointments.

The product is operated as a managed service. Platform operators configure and manage customer organizations, while client users access their own business workspace.

## 2. Target Customers

### Primary Market

US HVAC businesses, initially targeting companies with approximately 1–50 employees.

### Future Market

Other home-service businesses and agencies serving multiple customers may be supported in later phases.

## 3. Core Problems

The platform aims to address:

- Slow responses to new inquiries.
- Leads that are forgotten or not followed up.
- Poor visibility into lead status and follow-up activity.
- Difficulty tracking conversations and appointment outcomes.
- Fragmented workflows across communication and business tools.

## 4. Product Goals

The product should:

1. Capture incoming leads reliably.
2. Help businesses respond to leads promptly.
3. Track lead status and follow-up activity.
4. Support conversations and appointment scheduling.
5. Provide clear operational visibility through a dashboard.
6. Support multiple customer organizations with strict data isolation.
7. Allow platform operators to configure and support customer workspaces centrally.
8. Provide a reliable foundation for future AI-assisted automation.

## 5. Initial Development Scope

The product will be built incrementally through approved OpenSpec changes.

The first change, `tenant-foundation-and-onboarding`, establishes the security and identity foundation before lead-management features are introduced.

Its scope includes:

- Shared sign-in for platform operators and client users.
- No public self-registration.
- Server-verified operator authorization.
- Operator-managed organization creation.
- Operator-provisioned client owner accounts with operator-set initial passwords.
- Direct handover of client credentials by the operator and sign-in through the shared sign-in page.
- Server-side tenant authorization and isolation.
- Automated security tests and browser acceptance tests for onboarding.

The first change does not implement the complete lead-management or automation product.

## 6. Planned Product Capabilities

After the tenant foundation is established, later approved changes may introduce:

- Lead intake through forms and APIs.
- Lead lists, details, and status tracking.
- SMS communication integrations.
- Automated follow-up workflows.
- AI-assisted conversations.
- Human takeover of conversations.
- Appointment scheduling and calendar views.
- Analytics and operational reporting.
- Workflow execution monitoring and error visibility.

These are roadmap items, not authorization to implement them in the first change.

## 7. User Types

### Platform Operator

A trusted platform-level user who manages customer organizations, onboarding, configuration, and support.

Operator privileges must be verified server-side and must not depend on client organization membership.

### Client Organization Owner

An operator-provisioned user who administers their own business workspace within the permissions explicitly provided by the product.

### Client Organization Member

An authorized user who accesses permitted functionality within their organization.

Client users must not gain platform operator privileges or access another organization's data.

## 8. Product Experience

The application should provide a clear, professional interface suitable for US HVAC businesses.

The planned client workspace may include:

- Dashboard
- Leads
- Conversations
- Calendar
- Analytics
- Automations
- Settings

Only features implemented and approved in the relevant change should be exposed as functional capabilities.

## 9. Product Principles

- Security and tenant isolation are foundational requirements.
- Operator-managed onboarding is the default business model.
- Do not provide public self-registration unless a future approved change explicitly introduces it.
- Never claim that an operation succeeded unless success has been verified.
- Automation must support safe human intervention.
- Prefer reliable, observable workflows over unnecessary complexity.
- Keep the MVP focused and introduce additional capabilities incrementally.
- Treat PostgreSQL as the authoritative source for core business records when those records are introduced.
- Use OpenSpec changes to control implementation scope and record requirement changes.

## 10. Out of Scope for the First Change

The tenant foundation and onboarding change must not independently introduce:

- Lead management features.
- SMS sending or receiving.
- AI conversation handling.
- Appointment booking.
- Analytics dashboards.
- Agency or white-label functionality.
- Unapproved billing or subscription functionality.
- Public account registration.

## 11. Definition of Product Success

The initial foundation is successful when an authorized operator can securely onboard a client organization, its provisioned owner can access the correct workspace, and unauthorized users cannot access operator functions or another organization's protected data.