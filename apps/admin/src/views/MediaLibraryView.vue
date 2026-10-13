<script setup lang="ts">
/*
 * 媒体库 —— **占位页**，本轮不实现。
 *
 * 为什么给一个真路由页而不是把菜单项做成禁用：
 * 禁用项在界面上只是"点不动"，用户无法知道是权限不足、还是功能没做；
 * 一个明说"建设中"的页面把这个疑问直接答掉，而且它让菜单的 key ↔ 路由 name ↔ 组件
 * 这条链在今天就完整了 —— 侧边栏高亮与跳转因此从第一天起就是真的被走过一遍的路径，
 * 不是等"以后做好了再接"。代价只是这一个 20 行的文件。
 *
 * 真实的媒体库能力（列表/删除/引用检查）目前在 `components/MediaPicker.vue` 里，
 * 它与路由页共用的接口是 `GET /api/admin/media`、`DELETE /api/admin/media/:id`。
 * 这里**刻意不把它抽出来共用**：抽早了会为了"看起来复用"而把选择器的交互细节
 * 反向约束到列表页上。等真正做列表页时再抽。
 */
</script>

<template>
  <h1>媒体库</h1>

  <div class="card">
    <n-empty description="媒体库页面还没做">
      <template #extra>
        <div style="max-width: 460px; text-align: left">
          <p class="muted" style="margin-top: 0">
            现在要上传或删除图片，请到「产品管理」里点任意产品的<strong>设封面</strong> ——
            弹出的图片选择器就是目前的媒体管理界面（含上传与删除）。
          </p>
          <p class="muted" style="margin-bottom: 0">
            单独的媒体库页面（浏览全部图片、按名称搜索、查看被哪些产品引用）属于后续批次。
          </p>
        </div>
      </template>
    </n-empty>
  </div>
</template>
