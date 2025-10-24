$changes = git status --porcelain
if ($changes) {
  git add -A
  $msg = "chore: autosave $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
  git commit -m $msg
  git push
}
