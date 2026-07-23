import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const parentRepository = "findmydoc-platform/management";
const childRepository = "findmydoc-platform/clinic-dashboard";
const childIssueNumber = 68;

function relationshipData(parent = null) {
  return {
    data: {
      parentRepository: {
        issue: {
          id: "parent-node-id",
          number: 338,
          url: `https://github.com/${parentRepository}/issues/338`,
        },
      },
      childRepository: {
        issue: {
          id: "child-node-id",
          number: childIssueNumber,
          url: `https://github.com/${childRepository}/issues/${childIssueNumber}`,
          repository: { nameWithOwner: childRepository },
          parent,
        },
      },
    },
  };
}

function mutationData() {
  return {
    data: {
      addSubIssue: {
        issue: { number: 338 },
        subIssue: { number: childIssueNumber },
      },
    },
  };
}

async function loadGitHub(githubJson) {
  return loadTranspiledModule("src/lib/github.ts", {
    "./github-repositories": {
      requireAllowedGitHubRepository: (value) => value || parentRepository,
      splitGitHubRepository: (value) => {
        const repository = value || parentRepository;
        const [owner, repo] = repository.split("/");
        return { owner, repo, repository };
      },
    },
    "./github-issue-reference": {
      assertGitHubIssueRepository: () => {},
      parseGitHubIssueUrl: () => null,
      resolveGitHubIssueNumber: () => null,
    },
    "./github-http": {
      githubJson,
      githubRequest: () => {
        throw new Error("Unexpected GitHub request");
      },
    },
  });
}

function connectionInput() {
  return {
    parentRepository,
    parentIssueNumber: 338,
    childRepository,
    childIssueNumber,
    token: "installation-token",
  };
}

test("existing GitHub sub-issue relationship is treated as a successful no-op", async () => {
  const requests = [];
  const github = await loadGitHub(async (_url, options) => {
    requests.push(options.body);
    return relationshipData({
      number: 338,
      url: `https://github.com/${parentRepository}/issues/338`,
      repository: { nameWithOwner: parentRepository },
    });
  });

  const result = await github.connectGitHubSubIssue(connectionInput());

  assert.equal(requests.length, 1);
  assert.match(requests[0].query, /childRepository: repository/);
  assert.equal(result.addSubIssue.issue.number, 338);
  assert.equal(result.addSubIssue.subIssue.number, childIssueNumber);
});

test("missing GitHub parent uses addSubIssue with resolved node IDs", async () => {
  const requests = [];
  const github = await loadGitHub(async (_url, options) => {
    requests.push(options.body);
    if (requests.length === 1) return relationshipData(null);
    return mutationData();
  });

  const result = await github.connectGitHubSubIssue(connectionInput());

  assert.equal(requests.length, 2);
  assert.match(requests[1].query, /replaceParent: true/);
  assert.match(requests[1].query, /subIssueId: \$child/);
  assert.doesNotMatch(requests[1].query, /subIssueUrl/);
  assert.deepEqual(requests[1].variables, {
    parent: "parent-node-id",
    child: "child-node-id",
  });
  assert.equal(result.addSubIssue.subIssue.number, childIssueNumber);
});

test("different GitHub parent is replaced with exactly one mutation", async () => {
  const requests = [];
  const github = await loadGitHub(async (_url, options) => {
    requests.push(options.body);
    if (requests.length === 1) {
      return relationshipData({
        number: 337,
        url: `https://github.com/${parentRepository}/issues/337`,
        repository: { nameWithOwner: parentRepository },
      });
    }
    return mutationData();
  });

  const result = await github.connectGitHubSubIssue(connectionInput());

  assert.equal(requests.length, 2);
  assert.match(requests[1].query, /replaceParent: true/);
  assert.deepEqual(requests[1].variables, {
    parent: "parent-node-id",
    child: "child-node-id",
  });
  assert.equal(result.addSubIssue.subIssue.number, childIssueNumber);
});

test("missing child issue fails before attempting the relationship mutation", async () => {
  const requests = [];
  const github = await loadGitHub(async (_url, options) => {
    requests.push(options.body);
    const result = relationshipData();
    result.data.childRepository.issue = null;
    return result;
  });

  await assert.rejects(
    () => github.connectGitHubSubIssue(connectionInput()),
    /GitHub Sub-Issue wurde nicht gefunden/,
  );
  assert.equal(requests.length, 1);
});

test("missing child node ID fails before attempting the relationship mutation", async () => {
  const requests = [];
  const github = await loadGitHub(async (_url, options) => {
    requests.push(options.body);
    const result = relationshipData();
    delete result.data.childRepository.issue.id;
    return result;
  });

  await assert.rejects(
    () => github.connectGitHubSubIssue(connectionInput()),
    /GitHub Sub-Issue-Node-ID wurde nicht gefunden/,
  );
  assert.equal(requests.length, 1);
});

test("missing parent node ID fails before attempting the relationship mutation", async () => {
  const requests = [];
  const github = await loadGitHub(async (_url, options) => {
    requests.push(options.body);
    const result = relationshipData();
    delete result.data.parentRepository.issue.id;
    return result;
  });

  await assert.rejects(
    () => github.connectGitHubSubIssue(connectionInput()),
    /GitHub Parent-Issue-Node-ID wurde nicht gefunden/,
  );
  assert.equal(requests.length, 1);
});

test("a lost addSubIssue response is reconciled before another mutation", async () => {
  let connected = false;
  let mutationCalls = 0;
  const github = await loadGitHub(async (_url, options) => {
    if (options.body.query.includes("query(")) {
      return relationshipData(connected ? {
        number: 338,
        url: `https://github.com/${parentRepository}/issues/338`,
        repository: { nameWithOwner: parentRepository },
      } : null);
    }
    mutationCalls += 1;
    connected = true;
    throw new Error("response lost after addSubIssue succeeded");
  });

  await assert.rejects(
    () => github.connectGitHubSubIssue(connectionInput()),
    /response lost/,
  );
  const replayed = await github.connectGitHubSubIssue(connectionInput());

  assert.equal(replayed.addSubIssue.issue.number, 338);
  assert.equal(replayed.addSubIssue.subIssue.number, childIssueNumber);
  assert.equal(mutationCalls, 1);
});
