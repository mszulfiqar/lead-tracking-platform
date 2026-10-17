## ADDED Requirements

### Requirement: Operator-created client accounts

The system SHALL allow an authorized platform operator to create client user accounts without enabling public self-registration.

#### Scenario: Operator creates a client account

- **WHEN** an authorized operator submits valid client account details
- **THEN** the system creates the client account through supported server-side authentication APIs
- **AND** the system reports success only after verifying account creation

#### Scenario: Unauthorized account creation

- **WHEN** a user without platform operator privileges attempts to create a client account
- **THEN** the system rejects the request
- **AND** no client account is created

### Requirement: Client organization membership

The system SHALL associate each provisioned client account with the intended organization and approved client role.

#### Scenario: Client account is assigned to an organization

- **WHEN** an authorized operator provisions a client account for an organization
- **THEN** the account receives the intended organization membership and approved client role
- **AND** the account receives no platform operator privileges

#### Scenario: Invalid organization assignment

- **WHEN** provisioning references an invalid or unauthorized organization
- **THEN** the system rejects the operation without creating an incorrectly assigned account

### Requirement: Initial client password

The system SHALL allow an authorized operator to set an initial client password using a password-setting mechanism supported by the installed authentication library.

#### Scenario: Initial password is set

- **WHEN** an authorized operator provisions a client account with a valid initial password
- **THEN** the password is processed using the authentication library's supported secure password-storage mechanism
- **AND** the client can authenticate using the initial credentials

#### Scenario: Password confidentiality

- **WHEN** the system processes or stores an initial password
- **THEN** it never stores or logs the password in plaintext
- **AND** it does not expose the password through URLs, analytics, error messages, or unrelated responses

### Requirement: Secure onboarding failure handling

The system SHALL handle provisioning failures without granting unauthorized access or reporting unverified success.

#### Scenario: Account provisioning fails

- **WHEN** organization or account provisioning fails
- **THEN** the system reports the failure accurately
- **AND** it does not report onboarding as complete unless the required state has been verified

#### Scenario: Public registration remains disabled

- **WHEN** an unauthenticated visitor attempts public self-registration
- **THEN** the system rejects the registration request
- **AND** client account creation remains restricted to authorized operator provisioning