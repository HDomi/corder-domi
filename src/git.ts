import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

interface GitHubUser {
  login: string;
}

export async function setupAndPushRepo(
  projectPath: string,
  appName: string,
  gitToken: string,
): Promise<string> {
  // 1. Get authenticated user name
  const userResponse = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${gitToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "coder-domi-bot",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!userResponse.ok) {
    const errorText = await userResponse.text();
    throw new Error(
      `GitHub 사용자 조회 실패: ${userResponse.statusText} (${errorText})`,
    );
  }

  const userData = (await userResponse.json()) as GitHubUser;
  const username = userData.login;
  const repoName = appName;

  // 2. Check if repository already exists
  const repoResponse = await fetch(
    `https://api.github.com/repos/${username}/${repoName}`,
    {
      headers: {
        Authorization: `Bearer ${gitToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "coder-domi-bot",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (repoResponse.status === 404) {
    // Repository does not exist, create it
    console.log(`Repository ${repoName} does not exist. Creating...`);
    const createResponse = await fetch("https://api.github.com/user/repos", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${gitToken}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github+json",
        "User-Agent": "coder-domi-bot",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        name: repoName,
        private: false,
        auto_init: false,
      }),
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new Error(
        `GitHub 레포지토리 생성 실패: ${createResponse.statusText} (${errorText})`,
      );
    }
  } else if (!repoResponse.ok) {
    throw new Error(
      `GitHub 레포지토리 확인 중 오류 발생: ${repoResponse.statusText}`,
    );
  }

  // 3. Local git setup
  if (!fs.existsSync(path.join(projectPath, ".git"))) {
    execSync("git init", { cwd: projectPath });
  }

  // Ensure git remote is set up correctly with token auth URL
  const remoteUrlWithToken = `https://${gitToken}@github.com/${username}/${repoName}.git`;

  try {
    execSync("git remote remove origin", { cwd: projectPath, stdio: "ignore" });
  } catch (e) {
    // Ignore if origin remote didn't exist
  }

  execSync(`git remote add origin ${remoteUrlWithToken}`, { cwd: projectPath });

  // Ensure default branch is main
  execSync("git branch -M main", { cwd: projectPath });

  // 4. Git commit & push
  const hasChanges = execSync("git status --porcelain", {
    cwd: projectPath,
    encoding: "utf-8",
  }).trim();
  if (hasChanges) {
    execSync("git add .", { cwd: projectPath });
    execSync('git commit -m "AUTO_COMMIT: 사용자 요청 커밋 반영"', {
      cwd: projectPath,
    });
  }

  try {
    execSync("git push -u origin main", { cwd: projectPath });
  } catch (pushError: any) {
    console.warn("Push failed, attempting force push...", pushError.message);
    execSync("git push -u origin main --force", { cwd: projectPath });
  }

  return `https://github.com/${username}/${repoName}`;
}

export async function setupPushAndDeployPages(
  projectPath: string,
  appName: string,
  gitToken: string,
): Promise<{ repoUrl: string; pagesUrl: string }> {
  // 0. Ensure workflows directory exists and write deploy-pages.yml
  const workflowsDir = path.join(projectPath, ".github/workflows");
  if (!fs.existsSync(workflowsDir)) {
    fs.mkdirSync(workflowsDir, { recursive: true });
  }
  const workflowPath = path.join(workflowsDir, "deploy-pages.yml");
  const workflowContent = `name: Deploy to GitHub Pages

on:
  push:
    branches: ["main"]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: true

jobs:
  deploy:
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
        continue-on-error: true

      - name: Install and Build
        run: |
          if [ -f package.json ]; then
            npm install
            npm run build --if-present
          fi

      - name: Determine upload directory
        id: determine_dir
        run: |
          if [ -d dist ]; then
            echo "dir=dist" >> $GITHUB_OUTPUT
          elif [ -d build ]; then
            echo "dir=build" >> $GITHUB_OUTPUT
          elif [ -d out ]; then
            echo "dir=out" >> $GITHUB_OUTPUT
          else
            echo "dir=." >> $GITHUB_OUTPUT
          fi

      - name: Setup Pages
        uses: actions/configure-pages@v4

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: \${{ steps.determine_dir.outputs.dir }}

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
`;

  if (!fs.existsSync(workflowPath)) {
    fs.writeFileSync(workflowPath, workflowContent, "utf-8");
  }

  // 1. Push code to GitHub
  const repoUrl = await setupAndPushRepo(projectPath, appName, gitToken);

  // 2. Fetch authenticated username
  const userResponse = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${gitToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "coder-domi-bot",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!userResponse.ok) {
    const errorText = await userResponse.text();
    throw new Error(
      `GitHub 사용자 조회 실패: ${userResponse.statusText} (${errorText})`,
    );
  }

  const userData = (await userResponse.json()) as GitHubUser;
  const username = userData.login;

  // 3. Configure GitHub Pages to use GitHub Actions workflow
  const pagesUrlCheck = `https://api.github.com/repos/${username}/${appName}/pages`;
  const pagesResponse = await fetch(pagesUrlCheck, {
    headers: {
      Authorization: `Bearer ${gitToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "coder-domi-bot",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (pagesResponse.status === 404) {
    console.log("GitHub Pages가 설정되어 있지 않습니다. 설정을 진행합니다...");
    const createPagesResponse = await fetch(`https://api.github.com/repos/${username}/${appName}/pages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${gitToken}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github+json",
        "User-Agent": "coder-domi-bot",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        build_type: "workflow",
        source: {
          branch: "main",
          path: "/"
        }
      }),
    });

    if (!createPagesResponse.ok) {
      const errorText = await createPagesResponse.text();
      console.warn(`GitHub Pages 활성화 실패: ${createPagesResponse.statusText} (${errorText})`);
    } else {
      console.log("GitHub Pages 활성화 완료!");
    }
  }

  return {
    repoUrl,
    pagesUrl: `https://${username}.github.io/${appName}/`,
  };
}

export async function deleteRemoteRepo(
  appName: string,
  gitToken: string,
): Promise<void> {
  // 1. Get authenticated user name
  const userResponse = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${gitToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "coder-domi-bot",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!userResponse.ok) {
    const errorText = await userResponse.text();
    throw new Error(
      `GitHub 사용자 조회 실패: ${userResponse.statusText} (${errorText})`,
    );
  }

  const userData = (await userResponse.json()) as GitHubUser;
  const username = userData.login;
  const repoName = appName;

  // 2. Delete remote repository
  const deleteResponse = await fetch(
    `https://api.github.com/repos/${username}/${repoName}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${gitToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "coder-domi-bot",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (deleteResponse.status !== 204 && deleteResponse.status !== 404) {
    const errorText = await deleteResponse.text();
    throw new Error(
      `GitHub 레포지토리 삭제 실패: ${deleteResponse.statusText} (${errorText})`,
    );
  }
}
