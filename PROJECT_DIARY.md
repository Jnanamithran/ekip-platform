# Project Diary Entry: EKIP Backend

## Week 1 — Friday, 16 October 2026

This week focused on locking down the first working version of the EKIP backend and validating the core security patterns before moving deeper into product features. We completed the initial backend review cycle and received approval on the first pass of the authentication and RBAC design, which gave us confidence to continue with the production-ready structure.

We finalized the backend foundation for multi-tenant organization workflows and strengthened the permission model around real access boundaries. The project now includes a PostgreSQL-backed schema for Organization, Workspace, Department, User, and Document, along with the role and permission model needed to enforce access control correctly across departments and workspaces. We also completed the initial admin flow for creating users and assigning them to secure organizational roles.

Key work completed this week:

- Built and tested the authentication flow with JWT issuance and middleware protection.
- Implemented login and refresh-token handling with secure session rotation and revocation support.
- Added organization-scoped admin create-user functionality that restricts user creation to the owning org.
- Enforced RBAC using values from the verified token instead of trusting request input, which was a major lesson in making tenant boundaries reliable.
- Validated the backend locally with PowerShell and pgAdmin, confirming that authentication and role propagation behaved as expected.
- Completed the first internal review and received approval to proceed with the next phase of implementation.

Learning outcome: we confirmed that secure authentication depends on correct password hashing, signed tokens, refresh token rotation, and strict validation of claims. More importantly, we learned that access control must remain tied to trusted server-side data, especially org_id, role_id, workspace_id, and department scope, so one tenant cannot read another tenant’s data.

## Week 2 — Friday, 23 October 2026

This week was dedicated to extending the foundation into the more complex RBAC and document access behaviors required for production use. We moved from basic authentication to department-aware access control and refined the role system so the platform can safely support organization-wide and department-specific permissions without leakage between groups.

We implemented scoped role support and introduced the ability to create custom roles that are either organization-wide or limited to a specific department. This was a crucial step because a single flat role model is not enough for real teams that need different permissions across departments such as finance, HR, IT, or support operations. We also added stricter checks around role assignment and department management so users are only assigned roles they are allowed to hold.

Key work completed this week:

- Added role-scope handling for organization-wide and department-specific roles.
- Extended the Prisma schema and migration flow to support role scope and department linkage safely.
- Added validation to prevent department-scoped roles from being assigned outside their own department.
- Tightened document authorization to ensure only permitted departments and allowed roles can access specific documents.
- Improved the role management flow in the admin and frontend interfaces so role creation, editing, and visibility respect the caller’s department and permission boundaries.
- Implemented checks to protect Owner-level role identity and preserve the organization-wide admin role from accidental misuse.
- Verified the backend with focused test coverage for role creation, assignment restrictions, document access, and migration safety.

Operationally, we also worked through a deeper review of the real requirement: secure access is not only about login, but about the combination of org identity, workspace scope, department membership, and document role access. We improved the code to ensure these values are evaluated together before any document search, document access management, or user assignment is allowed. This significantly reduced the risk of privilege escalation and helped make the RBAC model behave consistently across the application.

Overall, the first review was approved and the platform moved forward with the stronger, tenant-safe access model. The next phase will focus on more advanced role governance, ownership transfer protections, and deeper end-to-end validation around document and workspace operations.
