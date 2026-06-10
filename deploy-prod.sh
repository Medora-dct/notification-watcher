#!/bin/bash
# =============================================================================
# Medora Notification Watcher — Production Deployment Script
# =============================================================================
# Run this script ONCE to deploy everything to production.
# Prerequisites:
#   - AWS CLI configured with correct credentials
#   - kubectl configured with prod cluster context
#   - Docker installed and logged into ECR
#   - You are inside the notification-watcher-v2/ directory
# =============================================================================

set -e

# ─── CONFIG — Update these before running ─────────────────────────────────────
ACCOUNT_ID="337756366934"
REGION="eu-central-1"
NAMESPACE="hn4u-prod"
CLUSTER_NAME="<YOUR_PROD_CLUSTER_NAME>"         # e.g. hn4u-prod-cluster
OIDC_PROVIDER="oidc.eks.eu-central-1.amazonaws.com/id/<YOUR_PROD_OIDC_ID>"  # get from: aws eks describe-cluster --name <prod-cluster> --query "cluster.identity.oidc.issuer" --output text | sed 's|https://||'

MONGO_URI="<PROD_MONGO_URI>"                     # prod Atlas connection string
DB_NAME="<PROD_DB_NAME>"                         # prod database name
SES_FROM_EMAIL="noreply@medoradct.com"
SES_FROM_NAME="MEDORA notification"
APP_URL="https://medoradct.com"                  # prod app URL
API_GATEWAY_URL="<PROD_API_GATEWAY_URL>"         # after creating API Gateway

# Auto-generate JWT secret
JWT_SECRET=$(openssl rand -hex 32)
echo ">>> Generated JWT_SECRET: $JWT_SECRET"
echo ">>> IMPORTANT: Save this value — you'll need it for Lambda env var too"
echo ""

# ─── Resource names (all suffixed with -prod) ─────────────────────────────────
ECR_REPO="notification-watcher-prod"
LAMBDA_NAME="medora-unsubscribe-prod"
IAM_ROLE_NAME="notification-watcher-lambda-role-prod"
IAM_POLICY_NAME="notification-watcher-ses-policy-prod"
K8S_IAM_ROLE_NAME="notification-watcher-role-prod"
K8S_IAM_POLICY_NAME="notification-watcher-eks-ses-policy-prod"
SERVICE_ACCOUNT="notification-watcher-sa"
SECRET_NAME="notification-watcher-secret"
IMAGE_TAG="v1"
IMAGE_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${ECR_REPO}:${IMAGE_TAG}"

echo "================================================================="
echo " Medora Notification Watcher — Production Deployment"
echo "================================================================="
echo " Namespace:   $NAMESPACE"
echo " Region:      $REGION"
echo " Image:       $IMAGE_URI"
echo " Lambda:      $LAMBDA_NAME"
echo "================================================================="
echo ""

# ─── Step 1: Create ECR repository ───────────────────────────────────────────
echo ">>> [1/9] Creating ECR repository: $ECR_REPO"
aws ecr create-repository \
  --repository-name "$ECR_REPO" \
  --region "$REGION" 2>/dev/null || echo "    ECR repo already exists, skipping."

# ─── Step 2: Build and push Docker image ─────────────────────────────────────
echo ">>> [2/9] Building and pushing Docker image..."
aws ecr get-login-password --region "$REGION" | \
  docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

docker build -t "$ECR_REPO:$IMAGE_TAG" .
docker tag "$ECR_REPO:$IMAGE_TAG" "$IMAGE_URI"
docker push "$IMAGE_URI"
echo "    Image pushed: $IMAGE_URI"

# ─── Step 3: Create IAM role for Lambda ──────────────────────────────────────
echo ">>> [3/9] Creating IAM role for Lambda: $IAM_ROLE_NAME"
cat > /tmp/lambda-trust-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "lambda.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

aws iam create-role \
  --role-name "$IAM_ROLE_NAME" \
  --assume-role-policy-document file:///tmp/lambda-trust-policy.json 2>/dev/null || \
  echo "    Lambda IAM role already exists, skipping."

aws iam attach-role-policy \
  --role-name "$IAM_ROLE_NAME" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole 2>/dev/null || true

# ─── Step 4: Deploy Lambda function ──────────────────────────────────────────
echo ">>> [4/9] Deploying Lambda function: $LAMBDA_NAME"
cd ../unsubscribe-lambda
npm install --omit=dev
zip -r unsubscribe-lambda.zip index.js package.json node_modules/

aws lambda create-function \
  --function-name "$LAMBDA_NAME" \
  --runtime nodejs24.x \
  --role "arn:aws:iam::${ACCOUNT_ID}:role/${IAM_ROLE_NAME}" \
  --handler index.handler \
  --zip-file fileb://unsubscribe-lambda.zip \
  --region "$REGION" \
  --environment "Variables={MONGO_URI=${MONGO_URI},DB_NAME=${DB_NAME},JWT_SECRET=${JWT_SECRET}}" \
  2>/dev/null || \
  aws lambda update-function-code \
    --function-name "$LAMBDA_NAME" \
    --zip-file fileb://unsubscribe-lambda.zip \
    --region "$REGION"

echo "    Lambda deployed: $LAMBDA_NAME"
echo ""
echo "    ⚠️  NOW: Create API Gateway manually in AWS Console and point to $LAMBDA_NAME"
echo "    ⚠️  Then update API_GATEWAY_URL in this script and run step 5 manually"
echo ""
echo "    Press ENTER when API Gateway is ready and API_GATEWAY_URL is set..."
read -r
cd ../notification-watcher-v2

# ─── Step 5: Update Lambda with JWT secret ───────────────────────────────────
echo ">>> [5/9] Updating Lambda env vars with JWT_SECRET..."
aws lambda update-function-configuration \
  --function-name "$LAMBDA_NAME" \
  --region "$REGION" \
  --environment "Variables={MONGO_URI=${MONGO_URI},DB_NAME=${DB_NAME},JWT_SECRET=${JWT_SECRET}}"

# ─── Step 6: Create IAM role for EKS (IRSA) ──────────────────────────────────
echo ">>> [6/9] Creating IAM role for EKS IRSA: $K8S_IAM_ROLE_NAME"
cat > /tmp/ses-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowSESSendEmail",
      "Effect": "Allow",
      "Action": ["ses:SendEmail", "ses:SendRawEmail"],
      "Resource": "*"
    }
  ]
}
EOF

aws iam create-policy \
  --policy-name "$K8S_IAM_POLICY_NAME" \
  --policy-document file:///tmp/ses-policy.json 2>/dev/null || \
  echo "    SES policy already exists, skipping."

cat > /tmp/eks-trust-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::${ACCOUNT_ID}:oidc-provider/${OIDC_PROVIDER}"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "${OIDC_PROVIDER}:sub": "system:serviceaccount:${NAMESPACE}:${SERVICE_ACCOUNT}",
          "${OIDC_PROVIDER}:aud": "sts.amazonaws.com"
        }
      }
    }
  ]
}
EOF

aws iam create-role \
  --role-name "$K8S_IAM_ROLE_NAME" \
  --assume-role-policy-document file:///tmp/eks-trust-policy.json 2>/dev/null || \
  echo "    EKS IAM role already exists, skipping."

aws iam attach-role-policy \
  --role-name "$K8S_IAM_ROLE_NAME" \
  --policy-arn "arn:aws:iam::${ACCOUNT_ID}:policy/${K8S_IAM_POLICY_NAME}" 2>/dev/null || true

# ─── Step 7: Create Kubernetes namespace and secret ───────────────────────────
echo ">>> [7/9] Creating Kubernetes namespace and secret..."
kubectl create namespace "$NAMESPACE" 2>/dev/null || echo "    Namespace already exists, skipping."

kubectl create secret generic "$SECRET_NAME" \
  --namespace "$NAMESPACE" \
  --from-literal=MONGO_URI="$MONGO_URI" \
  --from-literal=SES_FROM_EMAIL="$SES_FROM_EMAIL" \
  --from-literal=JWT_SECRET="$JWT_SECRET" \
  --from-literal=LAMBDA_URL="$API_GATEWAY_URL" \
  2>/dev/null || \
  kubectl delete secret "$SECRET_NAME" -n "$NAMESPACE" && \
  kubectl create secret generic "$SECRET_NAME" \
    --namespace "$NAMESPACE" \
    --from-literal=MONGO_URI="$MONGO_URI" \
    --from-literal=SES_FROM_EMAIL="$SES_FROM_EMAIL" \
    --from-literal=JWT_SECRET="$JWT_SECRET" \
    --from-literal=LAMBDA_URL="$API_GATEWAY_URL"

# ─── Step 8: Generate and apply production deployment.yaml ───────────────────
echo ">>> [8/9] Generating production deployment.yaml..."
cat > /tmp/prod-deployment.yaml << EOF
apiVersion: v1
kind: ServiceAccount
metadata:
  name: ${SERVICE_ACCOUNT}
  namespace: ${NAMESPACE}
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::${ACCOUNT_ID}:role/${K8S_IAM_ROLE_NAME}

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-watcher
  namespace: ${NAMESPACE}
  labels:
    app: notification-watcher
spec:
  replicas: 1
  selector:
    matchLabels:
      app: notification-watcher
  template:
    metadata:
      labels:
        app: notification-watcher
    spec:
      serviceAccountName: ${SERVICE_ACCOUNT}
      containers:
        - name: notification-watcher
          image: ${IMAGE_URI}
          imagePullPolicy: Always
          env:
            - name: MONGO_URI
              valueFrom:
                secretKeyRef:
                  name: ${SECRET_NAME}
                  key: MONGO_URI
            - name: SES_FROM_EMAIL
              valueFrom:
                secretKeyRef:
                  name: ${SECRET_NAME}
                  key: SES_FROM_EMAIL
            - name: JWT_SECRET
              valueFrom:
                secretKeyRef:
                  name: ${SECRET_NAME}
                  key: JWT_SECRET
            - name: LAMBDA_URL
              valueFrom:
                secretKeyRef:
                  name: ${SECRET_NAME}
                  key: LAMBDA_URL
            - name: DB_NAME
              value: "${DB_NAME}"
            - name: AWS_REGION
              value: "${REGION}"
            - name: APP_URL
              value: "${APP_URL}"
            - name: SES_FROM_NAME
              value: "MEDORA notification"
          resources:
            requests:
              memory: "128Mi"
              cpu: "50m"
            limits:
              memory: "256Mi"
              cpu: "200m"
EOF

kubectl apply -f /tmp/prod-deployment.yaml

# ─── Step 9: Verify deployment ────────────────────────────────────────────────
echo ">>> [9/9] Verifying deployment..."
kubectl rollout status deployment/notification-watcher -n "$NAMESPACE"
echo ""
echo "================================================================="
echo " ✅ Production deployment complete!"
echo "================================================================="
echo " Resources created:"
echo "   ECR Repo:       $ECR_REPO"
echo "   Lambda:         $LAMBDA_NAME"
echo "   Lambda Role:    $IAM_ROLE_NAME"
echo "   EKS Role:       $K8S_IAM_ROLE_NAME"
echo "   K8s Namespace:  $NAMESPACE"
echo "   K8s Secret:     $SECRET_NAME"
echo "   Image:          $IMAGE_URI"
echo ""
echo " Watch logs:"
echo "   kubectl logs -f deployment/notification-watcher -n $NAMESPACE"
echo "================================================================="
