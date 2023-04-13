import { Duration, RemovalPolicy, Stack, StackProps, Token } from 'aws-cdk-lib';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as codedeploy from 'aws-cdk-lib/aws-codedeploy';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { aws_elasticloadbalancingv2 as elbv2, } from 'aws-cdk-lib';
import { DockerImageAsset, Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as ecrdeploy from 'cdk-ecr-deployment';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

const generateRandomString = (charCount = 7): string => {
  const str = Math.random().toString(36).substring(2).slice(-charCount)
  return str.length < charCount ? str + 'a'.repeat(charCount - str.length) : str
};
export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    /**
     * ネットワーク関連
     */
    // create a VPC
    const vpc = new ec2.Vpc(this, 'VPCBG', {
      ipAddresses: ec2.IpAddresses.cidr('192.168.0.0/16'),
      maxAzs: 3,
      subnetConfiguration: [
        {
          // PublicSubnet
          cidrMask: 24,
          name: 'ingress',
          subnetType: ec2.SubnetType.PUBLIC,
        },        
        {
          // PrivateSubnet
          cidrMask: 24,
          name: 'private',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // ECR PullするためのVPCエンドポイント
    // 不要なものがあるかもしれない
    vpc.addInterfaceEndpoint("ecr-endpoint", {
      service: ec2.InterfaceVpcEndpointAwsService.ECR
    });
    vpc.addInterfaceEndpoint("ecr-dkr-endpoint", {
      service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER
    });    
    vpc.addGatewayEndpoint("s3-gateway-endpoint", {
      service: ec2.GatewayVpcEndpointAwsService.S3
    });
    vpc.addInterfaceEndpoint('cloud-watch-logs', {
      service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS
    });    

    // LoadBarancer用のセキュリティグループ
    const securityGroupELB = new ec2.SecurityGroup(this, 'SecurityGroupELB', {
      vpc,
      description: 'Security group ELB',
      securityGroupName: 'SGELB',
    });
    // 証明書関連はドメインに依存するので省略
    securityGroupELB.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP traffic from the world');
    securityGroupELB.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(9000), 'Allow HTTP traffic from the world for Green');

    // ECSで動作するアプリ用のセキュリティグループ
    const securityGroupAPP = new ec2.SecurityGroup(this, 'SecurityGroupAPP', {
      vpc,
      description: 'Security group APP',
      securityGroupName: 'SGAPP',
    })
    securityGroupAPP.addIngressRule(securityGroupELB, ec2.Port.tcp(80), 'Allow HTTP traffic from the ELB');

    /**
     * For App1
     */
    // Application Load Balancer
    const app1alb = new elbv2.ApplicationLoadBalancer(this, 'ALB1', {
      vpc,
      internetFacing: true,
      loadBalancerName: 'app1-sample-cdk-bg-alb',
    });

    // Blue リスナー
    const app1blueListener = app1alb.addListener('App1BlueListener', {
      port: 80,
      open: true,
    });

    // Blue Target Group
    const app1blueTargetGroup = new elbv2.ApplicationTargetGroup(this, 'App1BlueTargetGroup', {
      vpc,
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/',
        interval: Duration.seconds(60),
        healthyHttpCodes: '200'
      },
    });
    app1blueListener.addTargetGroups('App1BlueTargetGroup', {
      targetGroups: [app1blueTargetGroup],
    });

    // Green リスナー
    const app1greenListener = app1alb.addListener('App1GreenListener', {
      protocol: elbv2.ApplicationProtocol.HTTP,
      port: 9000,
      open: true,
    })    

    // Green Target Group
    const app1greenTargetGroup = new elbv2.ApplicationTargetGroup(this, 'App1GreenTargetGroup', {
      vpc,
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/',
        interval: Duration.seconds(60),
        healthyHttpCodes: '200'
      },
    });
    app1greenListener.addTargetGroups('App1GreenTargetGroup', {
      targetGroups: [app1greenTargetGroup]
    });

    /**
     * For App2
     */
    const app2alb = new elbv2.ApplicationLoadBalancer(this, 'ALB2', {
      vpc,
      internetFacing: true,
      loadBalancerName: 'app2-sample-cdk-bg-alb',
    });

    // Blue リスナー
    const app2blueListener = app2alb.addListener('App2BlueListener', {
      port: 80,
      open: true,
    });

    // Blue Target Group
    const app2blueTargetGroup = new elbv2.ApplicationTargetGroup(this, 'App2BlueTargetGroup', {
      vpc,
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/',
        interval: Duration.seconds(60),
        healthyHttpCodes: '200'
      },
    });
    app2blueListener.addTargetGroups('App2BlueTargetGroup', {
      targetGroups: [app2blueTargetGroup],
    });

    // Green リスナー
    const app2greenListener = app2alb.addListener('App2GreenListener', {
      protocol: elbv2.ApplicationProtocol.HTTP,
      port: 9000,
      open: true,
    })    

    // Green Target Group
    const app2greenTargetGroup = new elbv2.ApplicationTargetGroup(this, 'App2GreenTargetGroup', {
      vpc,
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/',
        interval: Duration.seconds(60),
        healthyHttpCodes: '200'
      },
    });
    app2greenListener.addTargetGroups('App2GreenTargetGroup', {
      targetGroups: [app2greenTargetGroup]
    });    

    // tag
    const tag = generateRandomString();
    
    /**
     * ECR関連 For App1
     */
    // リポジトリの作成
    const repo1 = new ecr.Repository(this, "cdk-ecs-multi-gb-l2-repo-1", {
      repositoryName: 'cdk-ecs-multi-bg-sample-repo-1',
      removalPolicy: RemovalPolicy.DESTROY
    });


    // ビルド to CDKデフォルトリポジトリ
    const image1 = new DockerImageAsset(this, 'CDKDockerImage1', {
      directory: '../app',
      platform: Platform.LINUX_ARM64,
    });
    // ビルドしたイメージをコピー to マイリポジトリ(SAMPLEなのでlatestタグ)
    new ecrdeploy.ECRDeployment(this, 'DeployDockerImage1', {
      src: new ecrdeploy.DockerImageName(image1.imageUri),
      dest: new ecrdeploy.DockerImageName(repo1.repositoryUri + ':' + tag),
    });

    /**
     * ECS関連 For App2
     */
    // リポジトリの作成
    const repo2 = new ecr.Repository(this, "cdk-ecs-multi-gb-l2-repo-2", {
      repositoryName: 'cdk-ecs-multi-bg-sample-repo-2',
      removalPolicy: RemovalPolicy.DESTROY
    });

    // ビルド to CDKデフォルトリポジトリ
    const image2 = new DockerImageAsset(this, 'CDKDockerImage2', {
      directory: '../app2',
      platform: Platform.LINUX_ARM64,
    });
    // ビルドしたイメージをコピー to マイリポジトリ(SAMPLEなのでlatestタグ)
    new ecrdeploy.ECRDeployment(this, 'DeployDockerImage2', {
      src: new ecrdeploy.DockerImageName(image2.imageUri),
      dest: new ecrdeploy.DockerImageName(repo2.repositoryUri + ':' + tag),
    });

    /**
     * ECS関連
     */

    // ECS クラスタの作成    
    const cluster = new ecs.Cluster(this, 'ECSCluster', {
      vpc: vpc,
      clusterName: `SAMPLE-ECSCluster-MultiService`,
      containerInsights: true,
    });

    /**
     * Service For App1
     */
    // タスク定義
    const fargateTaskDefinitionApp1 = new ecs.FargateTaskDefinition(this, 'SampleTaskDefApp1', {
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
      },      
      ephemeralStorageGiB: 0,
      memoryLimitMiB: 1024 * 2,
      cpu: 1024 * 1,
    });
    // 自動で作られるTaskExecutionRoleでは、ECRからPullできなかったので、
    // AmazonECSTaskExecutionRolePolicyを適用
    fargateTaskDefinitionApp1.addToExecutionRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          "ecr:GetAuthorizationToken",
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "logs:CreateLogStream",
          "logs:PutLogEvents"          
        ],
        resources: ['*']
      })
    );    
    fargateTaskDefinitionApp1.addContainer('SampleECS1', {
      containerName: 'ecs-multiservice-container-1',
      image: ecs.ContainerImage.fromEcrRepository(repo1, tag), // タグの指定がここでできる
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'ecs-multiservice-1',
      }),
      portMappings: [{
        protocol: ecs.Protocol.TCP,
        containerPort: 80,
        hostPort: 80,
      }],      
    });
    // サービス
    const service1 = new ecs.FargateService(this, 'Service1', {
      serviceName: 'ecs-multiservice-1',
      cluster,
      taskDefinition: fargateTaskDefinitionApp1,
      securityGroups: [securityGroupAPP],
      enableExecuteCommand: true,
      desiredCount: 2,
      vpcSubnets: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }),
      deploymentController: { type: ecs.DeploymentControllerType.CODE_DEPLOY }, 
    });
    service1.attachToApplicationTargetGroup(app1blueTargetGroup);

    /**
     * Service For App2
     */    
    // タスク定義
    const fargateTaskDefinitionApp2 = new ecs.FargateTaskDefinition(this, 'SampleTaskDefApp2', {
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
      },      
      ephemeralStorageGiB: 0,
      memoryLimitMiB: 1024 * 2,
      cpu: 1024 * 1,
    });
    // 自動で作られるTaskExecutionRoleでは、ECRからPullできなかったので、
    // AmazonECSTaskExecutionRolePolicyを適用
    fargateTaskDefinitionApp2.addToExecutionRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          "ecr:GetAuthorizationToken",
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "logs:CreateLogStream",
          "logs:PutLogEvents"          
        ],
        resources: ['*']
      })
    );    
    fargateTaskDefinitionApp2.addContainer('SampleECS2', {
      containerName: 'ecs-multiservice-container-2',
      image: ecs.ContainerImage.fromEcrRepository(repo2, tag), // タグの指定がここでできる
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'ecs-multiservice-2',
      }),
      portMappings: [{
        protocol: ecs.Protocol.TCP,
        containerPort: 80,
        hostPort: 80,
      }],      
    });
    // サービス
    const service2 = new ecs.FargateService(this, 'Service2', {
      serviceName: 'ecs-multiservice-2',
      cluster,
      taskDefinition: fargateTaskDefinitionApp2,
      securityGroups: [securityGroupAPP],
      enableExecuteCommand: true,
      desiredCount: 2,
      vpcSubnets: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }),
      deploymentController: { type: ecs.DeploymentControllerType.CODE_DEPLOY }, 
    });
    service2.attachToApplicationTargetGroup(app2blueTargetGroup);


    // CodeDeploy の ECS アプリケーションを作成
    const ecsApplication = new codedeploy.EcsApplication(this, 'EcsApplication', {});

    // デプロイグループ
    const ecsDeploymentGroupApp1 = new codedeploy.EcsDeploymentGroup(this, 'EcsDeploymentGroupApp1', {
      blueGreenDeploymentConfig: {  // ターゲットグループやリスナー
        blueTargetGroup: app1blueTargetGroup,
        greenTargetGroup: app1greenTargetGroup,
        listener: app1blueListener,
        testListener: app1greenListener,
        deploymentApprovalWaitTime: cdk.Duration.minutes(10), // 待ち時間
        terminationWaitTime: cdk.Duration.minutes(10),        // 切り替え後に元のVersionを残しておく時間
      },
      // ロールバックの設定
      autoRollback: {  
          failedDeployment: true
      },
      service: service1,  // ECSサービス
      application: ecsApplication,  // ECSアプリケーション
      deploymentConfig: codedeploy.EcsDeploymentConfig.ALL_AT_ONCE, // デプロイの方式
    });
    const ecsDeploymentGroupApp2 = new codedeploy.EcsDeploymentGroup(this, 'EcsDeploymentGroupApp2', {
      blueGreenDeploymentConfig: {  // ターゲットグループやリスナー
        blueTargetGroup: app2blueTargetGroup,
        greenTargetGroup: app2greenTargetGroup,
        listener: app2blueListener,
        testListener: app2greenListener,
        deploymentApprovalWaitTime: cdk.Duration.minutes(10), // 待ち時間
        terminationWaitTime: cdk.Duration.minutes(10),        // 切り替え後に元のVersionを残しておく時間
      },
      // ロールバックの設定
      autoRollback: {  
          failedDeployment: true
      },
      service: service2,  // ECSサービス
      application: ecsApplication,  // ECSアプリケーション
      deploymentConfig: codedeploy.EcsDeploymentConfig.ALL_AT_ONCE, // デプロイの方式
    });

    // Create the application-level deployment group. アプリケーションレベルのデプロイメントグループ??
    /**

    const ecsCodeDeployRole = new iam.Role(this, 'EcsCodeDeployRole', {
      assumedBy: new iam.ServicePrincipal('codedeploy.amazonaws.com'),
      roleName: 'EcsCodeDeployRole',
    });

    const role1 = new iam.Role(this, 'Role1', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      roleName: 'CodeDeployRole1',
    });
    role1.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "iam:PassRole"
      ],
      resources: ['*']
    }));

    
    ecsCodeDeployRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "ecs:RegisterTaskDefinition",
        "ecs:DeregisterTaskDefinition",
        "ecs:UpdateServicePrimaryTaskSet",
        "ecs:DescribeServices",
        "ecs:ListTaskDefinitionFamilies",
        "ecs:ListTaskDefinitions",
        "ecs:DescribeTaskDefinition",
        "ecr:BatchGetImage",
        "ecr:GetAuthorizationToken",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchCheckLayerAvailability",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      resources: ['*']
    }));
    
    ecsCodeDeployRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "iam:PassRole"
      ],
      resources: ['*']
    }));
    
    const ecsCodeDeployPolicy = new iam.ManagedPolicy(this, 'EcsCodeDeployPolicy', {
      description: 'Managed policy for AWSCodeDeployRoleForECS',
      managedPolicyName: 'AWSCodeDeployRoleForECS',
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "codedeploy:CreateDeployment",
            "codedeploy:GetApplicationRevision",
            "codedeploy:RegisterApplicationRevision",
            "codedeploy:GetDeploymentConfig",
            "codedeploy:GetDeployment",
            "codedeploy:GetDeploymentInstance",
            "codedeploy:CreateDeploymentConfig",
            "codedeploy:DeleteDeploymentConfig",
            "codedeploy:UpdateDeploymentConfig",
            "codedeploy:ListDeploymentConfigs",
            "codedeploy:ListDeploymentGroups",
            "codedeploy:ListApplications",
            "codedeploy:BatchGetDeploymentInstances",
            "codedeploy:BatchGetDeployments"
          ],
          resources: ['*']
        })
      ]
    });
    
    ecsCodeDeployRole.addManagedPolicy(ecsCodeDeployPolicy);  
    const customDeploymentGroup = new cr.AwsCustomResource(this, 'ApplicationLevelDeploymentGroup', {
      role: role1,
      onCreate: {
        service: 'CodeDeploy',
        action: 'createDeploymentGroup',
        parameters: {
          applicationName: ecsApplication.applicationName,
          deploymentGroupName: 'application-level-deployment-group',
          deploymentConfigName: 'CodeDeployDefault.AllAtOnce',
          serviceRoleArn: ecsCodeDeployRole.roleArn,
          blueGreenDeploymentConfiguration: {
            deploymentReadyOption: {
              actionOnTimeout: 'CONTINUE_DEPLOYMENT',
              waitTimeInMinutes: 0
            },
            greenFleetProvisioningOption: {
              action: 'DISCOVER_EXISTING',
            },
            terminateBlueInstancesOnDeploymentSuccess: {
              action: 'TERMINATE',
              terminationWaitTimeInMinutes: 5
            },            
          },
          deploymentStyle: {
            deploymentType: 'BLUE_GREEN',
            deploymentOption: 'WITH_TRAFFIC_CONTROL',
          },          
          loadBalancerInfo: {
            targetGroupPairInfoList: [
              {
                targetGroups: [
                  {
                    name: app1blueTargetGroup.targetGroupFullName
                  },
                  {
                    name: app1greenTargetGroup.targetGroupFullName
                  }
                ]
              },
              {
                targetGroups: [
                  {
                    name: app2blueTargetGroup.targetGroupFullName
                  },
                  {
                    name: app2blueTargetGroup.targetGroupFullName
                  }
                ]
              }
            ]
          },
            ecsServices: [
              {
                serviceName: service1.serviceName,
                clusterName: service1.cluster.clusterName
              },
              {
                serviceName: service2.serviceName,
                clusterName: service2.cluster.clusterName
              }
            ],
          autoRollbackConfiguration: {
            enabled: true,
            events: ['DEPLOYMENT_FAILURE']
          },
        },
        physicalResourceId: cr.PhysicalResourceId.of('MyApplicationDeploymentGroup'),
      },
      onDelete: {
        service: 'CodeDeploy',
        action: 'deleteDeploymentGroup',
        parameters: {
          applicationName: ecsApplication.applicationName,
          deploymentGroupName: 'application-level-deployment-group',
        },
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE}),
    });

     */
  }
}

/**
 * sample of appspec.yaml:

version: 0.0
Resources:
  - TargetService:
      Type: AWS::ECS::Service
      Properties:
        TaskDefinition: "arn:aws:ecs:aws-region-id:aws-account-id:task-definition/ecs-demo-task-definition:revision-number"
        LoadBalancerInfo:
          ContainerName: "your-container-name"
          ContainerPort: your-container-port
*/
