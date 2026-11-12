# Houston — truecolor Oh My Zsh prompt matching the Houston editor theme.
# Uses ANSI 24-bit colors so the prompt can share the exact palette.

HOUSTON_RESET=$'\e[0m'
HOUSTON_BLUE=$'\e[38;2;84;185;255m'       # #54b9ff
HOUSTON_PURPLE=$'\e[38;2;172;175;255m'   # #acafff
HOUSTON_MINT=$'\e[38;2;75;243;200m'      # #4bf3c8
HOUSTON_CYAN=$'\e[38;2;0;218;239m'       # #00daef
HOUSTON_MUTED=$'\e[38;2;133;139;152m'     # #858b98
HOUSTON_GRAY=$'\e[38;2;84;88;100m'        # #545864
HOUSTON_GOLD=$'\e[38;2;255;212;147m'      # #ffd493
HOUSTON_PINK=$'\e[38;2;244;88;126m'      # #f4587e

ZSH_THEME_GIT_PROMPT_PREFIX=" %{${HOUSTON_GRAY}%}git:%{${HOUSTON_RESET}%} %{${HOUSTON_PURPLE}%}"
ZSH_THEME_GIT_PROMPT_SUFFIX="%{${HOUSTON_RESET}%}"
ZSH_THEME_GIT_PROMPT_DIRTY="%{${HOUSTON_GOLD}%}*%{${HOUSTON_RESET}%}"
ZSH_THEME_GIT_PROMPT_CLEAN=""

PROMPT="%{${HOUSTON_BLUE}%}╭─%{${HOUSTON_RESET}%} %{${HOUSTON_PURPLE}%}%~%{${HOUSTON_RESET}%}\$(git_prompt_info)"$'\n'"%{${HOUSTON_BLUE}%}╰─%{${HOUSTON_MINT}%}❯%{${HOUSTON_RESET}%} "
RPS1="%(?..%{${HOUSTON_PINK}%}✘ %?%{${HOUSTON_RESET}%})"
