import { Octokit } from "@octokit/rest";
const owner = process.env.GITHUB_OWNER;
const repo = process.env.GITHUB_REPO;
const octokit = new Octokit({ auth: process.env.GITHUB_PAT });

await octokit.pulls.update({ owner, repo, pull_number: 9, state: "closed" });
console.log("PR #9 closed");
await new Promise(r => setTimeout(r, 2000));
await octokit.pulls.update({ owner, repo, pull_number: 9, state: "open" });
console.log("PR #9 reopened — action should trigger now");

// Wait and poll for merge
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 4000));
  const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number: 9 });
  console.log(`  attempt ${i+1}: state=${pr.state} merged=${pr.merged} mergeable=${pr.mergeable}/${pr.mergeable_state}`);
  if (pr.merged) {
    console.log(`MERGED sha=${pr.merge_commit_sha?.slice(0,8)}`);
    break;
  }
  if (pr.state === "closed" && !pr.merged) {
    console.log("CLOSED without merge — investigate");
    break;
  }
}

const { data: runs } = await octokit.actions.listWorkflowRunsForRepo({ owner, repo, per_page: 3 });
console.log("Latest runs:");
for (const r of runs.workflow_runs) console.log(`  ${r.name} | ${r.head_branch} | ${r.status}/${r.conclusion}`);
