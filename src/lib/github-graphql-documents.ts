import { githubIssueFieldsSelection, githubIssueFieldValuesSelection, githubProjectFieldsSelection, githubProjectItemFieldValuesSelection } from "./github-sync/project-field-context";
// Exact provider documents shared by resource adapters and constrained installation transport.
// Domain orchestration and response interpretation remain in their resource modules.
export const projectValidationQuery = `query FounderOpsProjectValidation($owner: String!, $number: Int!) {
  organization(login: $owner) {
    projectV2(number: $number) {
      id
      number
      title
      closed
      url
      repositories(first: 100) {
        totalCount
        nodes { nameWithOwner }
      }
      fields(first: 100) {
        nodes {
          ... on ProjectV2FieldCommon { name dataType }
        }
      }
    }
  }
}`;

export const subIssueRelationshipQuery = `query(
    $parentOwner: String!,
    $parentRepo: String!,
    $parentNumber: Int!,
    $childOwner: String!,
    $childRepo: String!,
    $childNumber: Int!
  ) {
    parentRepository: repository(owner: $parentOwner, name: $parentRepo) {
      issue(number: $parentNumber) { id number url }
    }
    childRepository: repository(owner: $childOwner, name: $childRepo) {
      issue(number: $childNumber) {
        id
        number
        url
        repository { nameWithOwner }
        parent { number url repository { nameWithOwner } }
      }
    }
  }`;

export const connectSubIssueMutation = `mutation($parent: ID!, $child: ID!) {
    addSubIssue(input: { issueId: $parent, subIssueId: $child, replaceParent: true }) {
      issue { number url }
      subIssue { number url repository { nameWithOwner } parent { number url repository { nameWithOwner } } }
    }
  }`;

export const linkedPullRequestsQuery = `query($owner: String!, $repo: String!, $issueNumber: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $issueNumber) {
        closedByPullRequestsReferences(
          first: 100
          includeClosedPrs: true
          userLinkedOnly: false
        ) {
          nodes {
            title
            number
            url
            state
            merged
            mergedAt
            repository { nameWithOwner }
          }
        }
      }
    }
  }`;

export const subIssueParentQuery = `query FounderOpsInboundSubIssueParent(
  $owner: String!,
  $repo: String!,
  $number: Int!
) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      id
      number
      repository { nameWithOwner }
      parent { number repository { nameWithOwner } }
    }
  }
}`;

export const projectObservationQuery = `query FounderOpsInboundProjectItem(
  $owner: String!,
  $number: Int!,
  $itemId: ID!,
  $contentId: ID!
) {
  organization(login: $owner) {
    projectV2(number: $number) {
      id
      closed
      ${githubProjectFieldsSelection}
    }
    ${githubIssueFieldsSelection}
  }
  content: node(id: $contentId) {
    ... on Issue {
      id
      number
      repository { nameWithOwner }
      ${githubIssueFieldValuesSelection}
    }
  }
  item: node(id: $itemId) {
    ... on ProjectV2Item {
      id
      updatedAt
      isArchived
      project { id }
      content { ... on Issue { id } }
      ${githubProjectItemFieldValuesSelection}
    }
  }
}`;

export const issueFieldObservationQuery = `query FounderOpsInboundIssueField(
  $owner: String!,
  $contentId: ID!
) {
  organization(login: $owner) {
    ${githubIssueFieldsSelection}
  }
  content: node(id: $contentId) {
    ... on Issue {
      id
      number
      repository { nameWithOwner }
      ${githubIssueFieldValuesSelection}
    }
  }
}`;

export const fieldContextQuery = `query FounderOpsProjectFields($owner: String!, $number: Int!, $itemId: ID!) {
  organization(login: $owner) {
    projectV2(number: $number) {
      id
      closed
      ${githubProjectFieldsSelection}
    }
    ${githubIssueFieldsSelection}
  }
  node(id: $itemId) {
    ... on ProjectV2Item {
      id
      project { id }
      content {
        ... on Issue {
          id
          ${githubIssueFieldValuesSelection}
        }
      }
      ${githubProjectItemFieldValuesSelection}
    }
  }
}`;

export const updateProjectFieldMutation = `mutation UpdateFounderOpsProjectField(
  $projectId: ID!,
  $itemId: ID!,
  $fieldId: ID!,
  $value: ProjectV2FieldValue!
) {
  updateProjectV2ItemFieldValue(input: {
    projectId: $projectId,
    itemId: $itemId,
    fieldId: $fieldId,
    value: $value
  }) { projectV2Item { id } }
}`;

export const clearProjectFieldMutation = `mutation ClearFounderOpsProjectField($projectId: ID!, $itemId: ID!, $fieldId: ID!) {
  clearProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId }) {
    projectV2Item { id }
  }
}`;

export const setIssueFieldMutation = `mutation SetFounderOpsIssueField($issueId: ID!, $issueFields: [IssueFieldCreateOrUpdateInput!]!) {
  setIssueFieldValue(input: { issueId: $issueId, issueFields: $issueFields }) { issue { id } }
}`;

export const projectMembershipQuery = `query FounderOpsProjectMembership(
  $projectOwner: String!,
  $projectNumber: Int!,
  $repositoryOwner: String!,
  $repositoryName: String!,
  $issueNumber: Int!
) {
  organization(login: $projectOwner) {
    projectV2(number: $projectNumber) { id closed }
  }
  repository(owner: $repositoryOwner, name: $repositoryName) {
    issue(number: $issueNumber) {
      id
      projectItems(first: 100) {
        nodes { id isArchived project { id } }
      }
    }
  }
}`;

export const addProjectItemMutation = `mutation FounderOpsAddProjectItem($projectId: ID!, $contentId: ID!) {
  addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
    item { id }
  }
}`;

export const unarchiveProjectItemMutation = `mutation FounderOpsUnarchiveProjectItem($projectId: ID!, $itemId: ID!) {
  unarchiveProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) {
    item { id }
  }
}`;

export const installationGraphqlDocuments: ReadonlySet<string> = new Set([
  projectValidationQuery,
  subIssueRelationshipQuery,
  connectSubIssueMutation,
  linkedPullRequestsQuery,
  subIssueParentQuery,
  projectObservationQuery,
  issueFieldObservationQuery,
  fieldContextQuery,
  updateProjectFieldMutation,
  clearProjectFieldMutation,
  setIssueFieldMutation,
  projectMembershipQuery,
  addProjectItemMutation,
  unarchiveProjectItemMutation,
]);
