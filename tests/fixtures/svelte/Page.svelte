<script lang="ts">
import { blogClient } from './client.ts';

const load = async () => {
  const res = await blogClient.posts.$get();
  return res.json();
};

const submit = async () => {
  await blogClient.posts.$post({ json: { title: 'a' } });
};
</script>

<button on:click={load}>load</button>
<button on:click={submit}>submit</button>
