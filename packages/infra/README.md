# @spotifan/infra

AWS CDK v2 infrastructure for Spotifan — provisions all cloud resources in a single stack.

## Scripts

```bash
pnpm build            # Compile TypeScript
pnpm synth            # Synthesize CloudFormation template
pnpm deploy           # Deploy stack to AWS
```

## Prerequisites

- **AWS CLI** configured with credentials
- **AWS CDK** (`npx cdk bootstrap` if first deploy in the account/region)
- **Secrets Manager secret** `spotifan/config` created with the required shape (see below)
- Backend and frontend built before deploying (`pnpm -r run build`)

## AWS Resources

```
┌─────────────────────────────────────────────────┐
│                  CloudFront                      │
│         (SPA routing + API passthrough)          │
├──────────────────┬──────────────────────────────┤
│                  │                               │
│  Static assets   │  /api/*                       │
│       ↓          │    ↓                          │
│   S3 Bucket      │  HTTP API Gateway             │
│  (frontend/dist) │    ↓                          │
│                  │  API Lambda (Hono, 256 MB)     │
│                  │    ↓                          │
│                  │  Sync Worker Lambda (1 GB)     │
│                  │                               │
│                  │        ↓                      │
│                  │  DynamoDB (spotifan)           │
│                  │  + Secrets Manager             │
└──────────────────┴──────────────────────────────┘
```

### DynamoDB Table

- **Name:** `spotifan`
- **Billing:** Pay-per-request
- **Keys:** PK (partition) + SK (sort)
- **GSI:** GSI1 (GSI1PK + GSI1SK)
- **TTL:** `ttl` attribute
- **Point-in-time recovery:** Enabled
- **Removal policy:** RETAIN

### Lambda Functions

| Function    | Memory  | Timeout | Purpose                                 |
| ----------- | ------- | ------- | --------------------------------------- |
| API Handler | 256 MB  | 30s     | Hono API (auth, releases, sync trigger) |
| Sync Worker | 1024 MB | 15min   | Async album sync from Spotify           |

Both Lambdas run Node.js 22 and have access to DynamoDB and Secrets Manager.

### API Gateway

- **Type:** HTTP API (API Gateway v2)
- **Route:** `ANY /api/{proxy+}` → API Handler Lambda

### CloudFront + S3

- S3 bucket serves the frontend SPA (Origin Access Control)
- CloudFront handles SPA routing (403/404 → `index.html`)
- `/api/*` requests are forwarded to API Gateway (caching disabled)
- HTTPS redirect enabled

## Secrets Manager

The secret `spotifan/config` must be a JSON object:

```json
{
  "spotifyClientId": "your-spotify-client-id",
  "spotifyClientSecret": "your-spotify-client-secret",
  "cookieSecret": "a-random-string-of-at-least-32-characters"
}
```

## Deployment

### First-Time Setup

1. **Configure AWS credentials:**

   ```bash
   aws configure sso    # or aws configure for access keys
   ```

2. **Bootstrap CDK** (one-time per account/region):

   ```bash
   pnpm --filter @spotifan/infra cdk bootstrap
   ```

3. **Create the Secrets Manager secret** in the AWS Console or CLI:
   ```bash
   aws secretsmanager create-secret \
     --name spotifan/config \
     --secret-string '{"spotifyClientId":"...","spotifyClientSecret":"...","cookieSecret":"random-32-plus-char-string"}'
   ```

### Deploy

```bash
# Build all packages first
pnpm -r run build

# Deploy the stack
pnpm --filter @spotifan/infra deploy
```

The deploy command outputs the **CloudFront distribution URL**. After the first deploy:

1. Copy the CloudFront URL (e.g. `https://d1234abcdef.cloudfront.net`)
2. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
3. Add `https://<cloudfront-domain>/api/auth/callback` as a **Redirect URI**
4. Add your user email under **User Management** (required while the app is in development mode)

### Updating

After code changes, rebuild and redeploy:

```bash
pnpm -r run build
pnpm --filter @spotifan/infra deploy
```

CDK performs incremental updates — only changed resources are modified.

## GitHub Actions OIDC Setup (CD Pipeline)

The CD pipeline uses OIDC to assume an IAM role without long-lived credentials.

### 1. Create IAM OIDC Identity Provider

In the AWS Console (IAM > Identity providers > Add provider):

- **Provider type:** OpenID Connect
- **Provider URL:** `https://token.actions.githubusercontent.com`
- **Audience:** `sts.amazonaws.com`

### 2. Create IAM Role

Create a role with the following trust policy (replace `matheus-of-freitas/spotifan` with your repo):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:matheus-of-freitas/spotifan:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

Attach `AdministratorAccess` (or a narrower CDK deploy policy) to the role.

### 3. Add GitHub Secret

Store the role ARN as a GitHub repository secret named `AWS_DEPLOY_ROLE_ARN`.

## Stack Structure

```
lib/
├── app.ts                # CDK app entry point
├── spotifan-stack.ts     # Main stack — wires constructs together
└── constructs/
    ├── database.ts       # DynamoDB table
    ├── api.ts            # API Lambda + Sync Worker + HTTP API
    └── frontend.ts       # S3 bucket + CloudFront distribution
```
