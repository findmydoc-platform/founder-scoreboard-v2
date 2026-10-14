import { describe, expect, it } from "vitest";
import { isGitHubAssetUrl } from "@/features/tasks/model/github-comment-image";

describe("GitHub comment image", () => {
  it.each([
    "https://github.com/user-attachments/assets/asset-id",
    "https://user-images.githubusercontent.com/123/asset.png",
    "https://objects.githubusercontent.com/path/asset.png",
    "https://github-production-user-asset-6210df.s3.amazonaws.com/asset.png",
  ])("recognizes a GitHub-hosted asset at %s", (url) => {
    expect(isGitHubAssetUrl(url)).toBe(true);
  });

  it.each([
    "https://example.com/asset.png",
    "https://evilgithubusercontent.com/asset.png",
    "https://github-production-user-asset-attacker.example.com/asset.png",
    "not a url",
  ])("does not proxy an unrelated image at %s", (url) => {
    expect(isGitHubAssetUrl(url)).toBe(false);
  });
});
