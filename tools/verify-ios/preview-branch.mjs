// Every report links its own immutable commit. A single branch keeps past
// commits reachable without putting simulator output in the app history.
const branch = 'ios-verification-media';

export async function publishPreviewImages({ github, repo, runId, attempt, files }) {
  const git = github.rest.git;
  const tree = [];
  for (const { name, data } of files) {
    const { data: blob } = await git.createBlob({
      ...repo,
      content: data.toString('base64'),
      encoding: 'base64',
    });
    tree.push({ path: `${runId}/${attempt}/${name}`, type: 'blob', mode: '100644', sha: blob.sha });
  }
  const { data: snapshot } = await git.createTree({ ...repo, tree });
  // Reports for different runs may finish together. Only fast-forward the
  // branch, retrying with the winning report's commit as our new parent.
  for (let i = 0; ; i++) {
    let parent;
    try {
      const { data } = await git.getRef({ ...repo, ref: 'heads/' + branch });
      parent = data.object.sha;
    } catch (error) {
      if (error.status !== 404) throw error;
    }
    const { data: commit } = await git.createCommit({
      ...repo,
      message: `iOS verification previews for run ${runId}, attempt ${attempt}`,
      tree: snapshot.sha,
      parents: parent ? [parent] : [],
    });
    try {
      if (parent)
        await git.updateRef({ ...repo, ref: 'heads/' + branch, sha: commit.sha, force: false });
      else await git.createRef({ ...repo, ref: 'refs/heads/' + branch, sha: commit.sha });
      return commit.sha;
    } catch (error) {
      if (i >= 2 || ![409, 422].includes(error.status)) throw error;
    }
  }
}
