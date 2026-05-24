<template>
  <div>vue fixture</div>
</template>

<script setup lang="ts">
import { thingsClient } from "./client.ts";

const load = async () => {
  const res = await thingsClient.things.$get();
  return res.json();
};

const update = async (id: string) => {
  await thingsClient.things[":id"].$put({ param: { id }, json: {} });
};
</script>
