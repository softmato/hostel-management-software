# EMAIL_SYSTEM.md — Email Triggers & Templates

**Email Provider:** Resend
**Template Engine:** React Email (or Handlebars templates stored in `packages/shared/email-templates/`)
**Sending Strategy:** Immediate (no batching/digesting in v1)

This document specifies EVERY email trigger in the system. All emails must be implemented from Phase 1 onward as needed per phase.

---

## Email Infrastructure

### Template Structure

```
packages/shared/email-templates/
  auth/
    verification.tsx
    password-reset.tsx
    credentials-issued.tsx
    account-upgraded.tsx
  hostel/
    submission-received.tsx
    hostel-approved.tsx  # includes cook credentials section if enabled
    hostel-rejected.tsx
    inquiry-received.tsx
  cook/
    credentials-issued.tsx  # sent when cook portal enabled
  payment/
    payment-due-reminder.tsx
    payment-overdue.tsx
    proof-uploaded.tsx
    payment-verified.tsx
    payment-rejected.tsx
  resident/
    qr-activation.tsx
    new-notice.tsx
    complaint-status-updated.tsx
    complaint-resolved.tsx
  guardian/
    invitation.tsx
    sos-alert.tsx
  service-provider/
    registration-received.tsx
    provider-approved.tsx
    provider-rejected.tsx
  platform/
    new-hostel-pending.tsx
    subscription-expiring.tsx
```

### Sending Function

```typescript
// packages/shared/email/sender.ts
export async function sendEmail({
  to,
  subject,
  template,
  data,
  replyTo,
}: {
  to: string | string[];
  subject: string;
  template: string; // template name
  data: Record<string, any>;
  replyTo?: string;
}) {
  const html = await renderTemplate(template, data);
  
  await resend.emails.send({
    from: process.env.EMAIL_FROM!,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    replyTo,
  });
  
  // Log for debugging
  console.log(`[EMAIL] Sent ${template} to ${to}`);
}
```

---

## 1. Authentication & Account Emails

### 1.1 Email Verification (PUBLIC Signup)

**Trigger:** User signs up with email/password as PUBLIC role
**Recipients:** New user's email
**Template:** `auth/verification`
**Subject:** "Verify your email - Multi-Hostel Platform"

**Data:**
```typescript
{
  userName: string;
  verificationLink: string; // with time-limited token
  expiresIn: string; // "24 hours"
}
```

**Content:**
- Welcome message
- "Click to verify your email" CTA button
- Expiry notice
- Support contact

---

### 1.2 Hostel Admin Credentials (Post-Approval)

**Trigger:** Superadmin approves a hostel → auto-upgrades owner's account to HOSTEL_ADMIN
**Recipients:** Hostel owner's email
**Template:** `auth/credentials-issued`
**Subject:** "Your hostel has been approved! Login credentials inside"

**Data:**
```typescript
{
  hostelName: string;
  email: string;
  temporaryPassword: string; // only if new account created
  loginLink: string;
  dashboardLink: string;
}
```

**Content:**
- Congratulations message
- Login credentials (if applicable) OR note that existing password works
- Must change password on first login notice
- Dashboard link CTA
- Support contact

---

### 1.3 Warden Credentials

**Trigger:** Hostel admin creates a warden account
**Recipients:** Warden's email
**Template:** `auth/credentials-issued`
**Subject:** "You've been added as a warden - Login credentials"

**Data:**
```typescript
{
  hostelName: string;
  role: 'Warden';
  email: string;
  temporaryPassword: string;
  loginLink: string;
}
```

**Content:**
- "You've been added as warden for [Hostel Name]"
- Login credentials
- Must change password notice
- Support contact

---

### 1.4 Resident QR Activation

**Trigger:** Hostel admin registers a new resident
**Recipients:** Resident's email
**Template:** `resident/qr-activation`
**Subject:** "Welcome to [Hostel Name]! Activate your account"

**Data:**
```typescript
{
  residentName: string;
  hostelName: string;
  qrCodeImageUrl: string; // R2 URL
  activationCode: string; // fallback text code
  activationLink: string; // web activation page
  expiresIn: string; // "7 days"
}
```

**Content:**
- Welcome message
- QR code image (embedded)
- Alternative: manual activation code
- Activation link CTA
- Expiry notice
- Support contact

---

### 1.5 Guardian Invitation

**Trigger:** Resident sends guardian invitation
**Recipients:** Guardian's email
**Template:** `guardian/invitation`
**Subject:** "[Resident Name] has invited you as their guardian"

**Data:**
```typescript
{
  residentName: string;
  hostelName: string;
  relation: string;
  invitationLink: string;
  expiresIn: string;
}
```

**Content:**
- "[Resident Name] has added you as their [relation]"
- Brief explanation of guardian dashboard features
- "Accept invitation" CTA button
- Expiry notice
- Privacy assurance (limited access, not surveillance)

---

### 1.6 Password Reset

**Trigger:** User requests password reset
**Recipients:** User's email
**Template:** `auth/password-reset`
**Subject:** "Reset your password"

**Data:**
```typescript
{
  userName: string;
  resetLink: string;
  expiresIn: string;
}
```

**Content:**
- Password reset request confirmation
- "Reset password" CTA button
- Expiry notice
- "Didn't request this?" security notice

---

### 1.7 Account Upgraded

**Trigger:** PUBLIC account is upgraded to RESIDENT/WARDEN/GUARDIAN (account merge)
**Recipients:** User's email
**Template:** `auth/account-upgraded`
**Subject:** "Your account has been upgraded"

**Data:**
```typescript
{
  userName: string;
  newRole: string;
  hostelName: string;
  dashboardLink: string;
}
```

**Content:**
- "Your account has been upgraded to [Role]"
- New access explanation
- "Go to dashboard" CTA
- No password change needed (existing credentials work)

---

## 2. Hostel Management Emails

### 2.1 Hostel Submission Received

**Trigger:** Hostel owner submits hostel registration form
**Recipients:** Hostel owner's email
**Template:** `hostel/submission-received`
**Subject:** "Your hostel registration has been received"

**Data:**
```typescript
{
  hostelName: string;
  ownerName: string;
  submittedAt: string;
  estimatedReviewTime: string;
}
```

**Content:**
- Thank you message
- Submission confirmation
- What happens next
- Estimated review time
- Support contact

---

### 2.2 Hostel Approved

**Trigger:** Superadmin approves hostel
**Recipients:** Hostel owner's email
**Template:** `hostel/hostel-approved`
**Subject:** "🎉 Your hostel has been approved!"

**Note:** This is the SAME email as 1.2 (credentials issued). **If cook portal is enabled**, include additional section with cook credentials.

**Cook Credentials Section** (if cookPortalEnabled=true):
```
---
Cook Portal Access (Mobile Only)

Your dedicated cook can now use our mobile app to send food notifications:
- Cook Name: [cookName]
- Username: [cookEmail]
- Password: [cookPassword]
- Download App: [iOS Link] | [Android Link]

Features: Food Ready button, photo uploads, resident list
Note: Multiple cooks can share these credentials.
---
```

---

### 2.3 Hostel Rejected

**Trigger:** Superadmin rejects hostel
**Recipients:** Hostel owner's email
**Template:** `hostel/hostel-rejected`
**Subject:** "Hostel registration update"

**Data:**
```typescript
{
  hostelName: string;
  ownerName: string;
  rejectionReason: string;
  resubmitLink?: string;
  supportEmail: string;
}
```

**Content:**
- Professional rejection message
- Reason for rejection
- Option to resubmit with corrections (if applicable)
- Support contact for questions

---

### 2.4 Inquiry Received (to Hostel Admin)

**Trigger:** Public visitor submits inquiry form on hostel profile
**Recipients:** Hostel admin + wardens (if enabled in their settings)
**Template:** `hostel/inquiry-received`
**Subject:** "New inquiry for [Hostel Name]"

**Data:**
```typescript
{
  hostelName: string;
  inquirerName: string;
  inquirerPhone: string;
  inquirerEmail?: string;
  message?: string;
  inquiryLink: string; // link to inquiry in dashboard
  receivedAt: string;
}
```

**Content:**
- "New inquiry from [Name]"
- Contact details
- Message content
- "View in dashboard" CTA
- Quick actions: call, email

---

## 3. Payment Emails

### 3.1 Payment Due Reminder

**Trigger:** Scheduled job X days before due date (configurable in PlatformConfig)
**Recipients:** Resident + Guardian (if guardian has `feeStatus` permission enabled)
**Template:** `payment/payment-due-reminder`
**Subject:** "Payment due on [Date] - [Hostel Name]"

**Data:**
```typescript
{
  residentName: string;
  hostelName: string;
  amount: number;
  dueDate: string;
  paymentLink: string; // link to payment page in dashboard
  guardianMode: boolean; // different wording for guardian vs resident
}
```

**Content:**
- Friendly reminder
- Amount due
- Due date
- "Upload payment proof" CTA (for resident)
- "View payment status" link (for guardian)

---

### 3.2 Payment Overdue

**Trigger:** Scheduled job when payment is past due date
**Recipients:** Resident + Guardian (if enabled)
**Template:** `payment/payment-overdue`
**Subject:** "⚠️ Payment overdue - [Hostel Name]"

**Data:**
```typescript
{
  residentName: string;
  hostelName: string;
  amount: number;
  dueDate: string;
  daysOverdue: number;
  lateFee?: number;
  paymentLink: string;
  guardianMode: boolean;
}
```

**Content:**
- Overdue notice
- Amount + late fee (if applicable)
- Days overdue
- Urgent payment request
- "Upload payment proof now" CTA

---

### 3.3 Payment Proof Uploaded (to Admin)

**Trigger:** Resident uploads payment proof
**Recipients:** Hostel admin + wardens with payment verification permission
**Template:** `payment/proof-uploaded`
**Subject:** "Payment proof uploaded - [Resident Name]"

**Data:**
```typescript
{
  residentName: string;
  hostelName: string;
  amount: number;
  month: string;
  paymentMethod: string;
  verifyLink: string; // direct link to verification page
}
```

**Content:**
- "[Resident Name] has uploaded payment proof"
- Amount and month
- Payment method
- "Verify now" CTA

---

### 3.4 Payment Verified (to Resident)

**Trigger:** Hostel admin verifies payment proof
**Recipients:** Resident + Guardian (if enabled)
**Template:** `payment/payment-verified`
**Subject:** "✅ Payment verified - [Hostel Name]"

**Data:**
```typescript
{
  residentName: string;
  hostelName: string;
  amount: number;
  month: string;
  verifiedDate: string;
  receiptLink: string; // PDF receipt download
  guardianMode: boolean;
}
```

**Content:**
- "Payment verified!"
- Amount and month
- Receipt attached/link
- "Download receipt" CTA
- Thank you message

---

### 3.5 Payment Rejected (to Resident)

**Trigger:** Hostel admin rejects payment proof
**Recipients:** Resident only (NOT guardian)
**Template:** `payment/payment-rejected`
**Subject:** "Payment proof needs resubmission - [Hostel Name]"

**Data:**
```typescript
{
  residentName: string;
  hostelName: string;
  amount: number;
  month: string;
  rejectionReason: string;
  resubmitLink: string;
}
```

**Content:**
- Professional rejection notice
- Reason for rejection
- "Resubmit payment proof" CTA
- Support contact

---

## 4. Resident Activity Emails

### 4.1 New Notice Posted

**Trigger:** Hostel admin posts a notice with `targetAudience: 'residents'` or `'all'`
**Recipients:** All active residents in the hostel
**Recipients (if guardian-targeted):** Guardians if `targetAudience: 'guardians'` or `'all'`
**Template:** `resident/new-notice`
**Subject:** "[URGENT] New notice from [Hostel Name]" (if urgent) OR "New notice from [Hostel Name]"

**Data:**
```typescript
{
  hostelName: string;
  noticeTitle: string;
  noticeBody: string;
  category: string;
  isUrgent: boolean;
  postedDate: string;
  noticeLink: string;
}
```

**Content:**
- Notice title (bold if urgent)
- Notice body (truncated if too long)
- Category badge
- "Read full notice" CTA
- Posted date

**Note:** Skip email if PlatformConfig.emailSettings.sendNoticeEmails = false

---

### 4.2 Complaint Status Updated

**Trigger:** Hostel admin updates complaint status
**Recipients:** Resident who filed the complaint
**Recipients (guardian):** Guardian ONLY if resident has enabled `complaintStatus` in guardian permissions
**Template:** `resident/complaint-status-updated`
**Subject:** "Complaint update: [Complaint Title]"

**Data:**
```typescript
{
  residentName: string;
  complaintTitle: string;
  oldStatus: string;
  newStatus: string;
  updateMessage?: string;
  complaintLink: string;
  guardianMode: boolean;
}
```

**Content:**
- "Your complaint has been updated"
- Status change: [Old] → [New]
- Admin's update message (if any)
- "View complaint" CTA
- Guardian version: limited details, status only

---

### 4.3 Complaint Resolved

**Trigger:** Hostel admin marks complaint as RESOLVED
**Recipients:** Resident + Guardian (if complaint sharing enabled)
**Template:** `resident/complaint-resolved`
**Subject:** "✅ Your complaint has been resolved"

**Data:**
```typescript
{
  residentName: string;
  complaintTitle: string;
  resolvedDate: string;
  resolutionMessage?: string;
  complaintLink: string;
  confirmationLink: string; // for resident to confirm satisfaction
  guardianMode: boolean;
}
```

**Content:**
- "Complaint resolved!"
- Resolution details
- "Confirm resolution" CTA (for resident to close the loop)
- Thank you message

---

## 5. Safety & Emergency Emails

### 5.1 SOS Triggered

**Trigger:** Resident presses SOS button
**Recipients:**
  - Hostel admin (all admins)
  - Wardens (all active wardens)
  - Guardian (if linked and has emergency access)
**Template:** `guardian/sos-alert`
**Subject:** "🚨 EMERGENCY - SOS Alert from [Resident Name]"

**Data:**
```typescript
{
  residentName: string;
  hostelName: string;
  roomNumber?: string;
  timestamp: string;
  emergencyContact: string;
  dashboardLink: string;
}
```

**Content:**
- "EMERGENCY: [Resident Name] has triggered an SOS alert"
- Timestamp
- Room number (if available)
- Emergency contact number
- "View details" CTA
- Urgent styling (red banner)

**Note:** This is the MOST CRITICAL email - must have highest priority sending

---

## 6. Service Provider Emails

### 6.1 Service Provider Registration Received

**Trigger:** Public user submits service provider registration form
**Recipients:** Service provider's email
**Template:** `service-provider/registration-received`
**Subject:** "Service provider registration received"

**Data:**
```typescript
{
  providerName: string;
  category: string;
  area: string;
  estimatedReviewTime: string;
}
```

**Content:**
- Thank you for registering
- Submission confirmation
- Review process explanation
- Estimated approval time

---

### 6.2 Service Provider Approved

**Trigger:** Superadmin/moderator approves service provider
**Recipients:** Service provider's email
**Template:** `service-provider/provider-approved`
**Subject:** "✅ Your service provider profile has been approved"

**Data:**
```typescript
{
  providerName: string;
  category: string;
  area: string;
  profileLink: string;
}
```

**Content:**
- Approval confirmation
- "Your profile is now live"
- Profile link
- What to expect (hostels may contact you)

---

### 6.3 Service Provider Rejected

**Trigger:** Superadmin/moderator rejects service provider
**Recipients:** Service provider's email
**Template:** `service-provider/provider-rejected`
**Subject:** "Service provider registration update"

**Data:**
```typescript
{
  providerName: string;
  rejectionReason: string;
  supportEmail: string;
}
```

**Content:**
- Professional rejection
- Reason
- Option to resubmit with corrections
- Support contact

---

## 7. Platform Admin Emails

### 7.1 New Hostel Pending Approval (to Superadmin)

**Trigger:** Hostel owner submits hostel registration
**Recipients:** All SUPERADMIN + PLATFORM_MODERATOR users
**Template:** `platform/new-hostel-pending`
**Subject:** "New hostel pending approval - [Hostel Name]"

**Data:**
```typescript
{
  hostelName: string;
  ownerName: string;
  ownerEmail: string;
  city: string;
  submittedAt: string;
  reviewLink: string;
}
```

**Content:**
- "New hostel submission"
- Basic details
- "Review now" CTA
- Quick approve/reject actions

---

### 7.2 Subscription Expiring Soon

**Trigger:** Scheduled job X days before subscription expires (configurable)
**Recipients:** Hostel admin
**Template:** `platform/subscription-expiring`
**Subject:** "Your subscription expires in [X] days"

**Data:**
```typescript
{
  hostelName: string;
  plan: string;
  expiryDate: string;
  daysRemaining: number;
  renewLink: string;
}
```

**Content:**
- Subscription expiry notice
- Plan details
- Days remaining
- "Renew now" CTA
- Consequences of expiry

---

## Email Opt-In/Opt-Out Matrix

### Resident Control

Residents can control:
- Payment reminders: YES (via settings)
- Notice emails: YES (via settings)
- Complaint updates: NO (always sent)
- SOS alerts to guardian: YES (via guardian permissions)

### Guardian Control

Guardians receive emails based on resident-set permissions:
- Fee status emails: If `accessPermissions.feeStatus = true`
- Notice emails: If `accessPermissions.notices = true`
- SOS alerts: If `accessPermissions.nightSafety = true` (emergency access)
- Complaint updates: If `accessPermissions.complaintStatus = true`

### Platform Control (PlatformConfig)

Superadmin can disable globally:
- `emailSettings.sendPaymentReminders`
- `emailSettings.sendNoticeEmails`
- `emailSettings.sendComplaintUpdates`

SOS emails CANNOT be disabled.

---

## Implementation Checklist

- [ ] Set up Resend account and get API key
- [ ] Create all email templates in `packages/shared/email-templates/`
- [ ] Implement `sendEmail()` helper function
- [ ] Create email service layer in `packages/shared/email/`
- [ ] Add email queue (optional: use Vercel Queue or BullMQ for reliability)
- [ ] Implement all triggers in respective route handlers
- [ ] Add email preferences to User/Resident/Guardian settings
- [ ] Test all email scenarios in development
- [ ] Set up email logging/monitoring for debugging
- [ ] Configure SPF/DKIM/DMARC for production domain

---

_End of EMAIL_SYSTEM.md_



---

## 7. Attendance & Location Tracking Emails

### 7.1 Attendance Alert (Resident Absent)

**Trigger:** Resident absent (OUTSIDE or UNKNOWN) for X consecutive days (default: 14)
**Recipients:** Hostel admin + wardens
**Template:** `attendance/resident-absent-alert`
**Subject:** "Attendance Alert: [Resident Name] absent for [X] days"

**Data:**
```typescript
{
  residentName: string;
  roomNumber: string;
  consecutiveDaysAbsent: number;
  lastSeenDate: string;
  attendanceDetailLink: string;
}
```

**Content:**
- Alert: Resident has been absent for X days
- Last seen date/time
- Link to attendance dashboard
- Suggested action: Contact resident or guardian

---

## 8. Community & Notification Emails

### 8.1 Community Post Engagement (Batched)

**Trigger:** Resident's post receives likes/comments (batched hourly)
**Recipients:** Post author
**Template:** `community/post-engagement`
**Subject:** "[X] people engaged with your post"

**Data:**
```typescript
{
  postTitle: string;
  likeCount: number;
  commentCount: number;
  topCommenterName?: string;
  postLink: string;
}
```

**Note:** Batched to avoid spam. Sent max once per hour per user.

---

## 9. Account & Privacy Emails

### 9.1 Account Deletion Requested

**Trigger:** User requests account deletion
**Recipients:** User's email
**Template:** `account/deletion-requested`
**Subject:** "Account deletion requested - 60 days to cancel"

**Data:**
```typescript
{
  userName: string;
  scheduledDeletionDate: string; // 60 days from now
  cancelLink: string;
}
```

**Content:**
- Confirmation of deletion request
- 60-day grace period explanation
- What will be deleted
- Link to cancel deletion
- Urgent: You have until [date] to cancel

**Built:** `packages/shared/src/email/templates/account/deletion-requested.ts`.
Also sent when a superadmin **approves** a hostel owner's `PLATFORM_REVIEW`
request, since that is the moment their 60-day clock actually starts.

### 9.1a Account Deletion Request Needs Review *(added 2026-08-02)*

**Trigger:** A `HOSTEL_ADMIN` asks to delete their account
**Recipients:** every active SUPERADMIN
**Template:** `platform/account-deletion-review`
**Subject:** "Account deletion request from {name}"

Not in the original spec, because the spec assumed every account could delete
itself. A hostel owner's cannot — their residents, payments and staff depend on
it — so the request is routed for review instead (ARCHITECTURE.md §13.0). The
mail carries who asked, their role, the hostels attached to the account, their
reason, and a link to `/platform/account-deletions`. It states plainly that
nothing has changed on the account yet.

### 9.2 Account Deletion Cancelled

**Trigger:** User cancels deletion request during grace period
**Recipients:** User's email
**Template:** `account/deletion-cancelled`
**Subject:** "Your account has been reactivated"

**Content:**
- Confirmation account is active again
- All data preserved
- Login link

**Built:** `packages/shared/src/email/templates/account/deletion-cancelled.ts`.

### 9.3 Location History Deletion Approved

**Trigger:** Admin approves resident's location history deletion request
**Recipients:** Resident's email
**Template:** `privacy/location-history-deleted`
**Subject:** "Location history deleted"

**Content:**
- Confirmation all location data deleted
- What was deleted: AttendanceLog entries
- What was retained: Aggregated statistics (no personal identifiers)

---

_End of EMAIL_SYSTEM.md_
