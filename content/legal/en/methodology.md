<!-- Public methodology (P0-6). Do not publish numeric ranking weights. Model name is subject to user confirmation. -->

## 1. Collection

- Three times a day (09:00, 14:00 and 23:00 Korea time) we read the public feeds of six Chinese outlets, listed on the [About](/about) page.
- Each run processes a capped number of articles, so a burst from one outlet does not crowd out the others.
- Each original URL is stored once. When several outlets carry the same piece (reposts), we group them by title similarity and count them as one story.

## 2. AI-relevance filter

Before translation, an AI classifier keeps only articles related to AI technology, products and business. General economy and society stories are left out of list filters and briefing candidates. The classifier is not perfect: some loosely related articles may remain and some relevant ones may be missed.

## 3. Translation, summaries and insights

- Titles, summaries, key terms and insights are written in Korean, English and Chinese by a large language model, based on the original. The model currently used is {{model}}.
- We never show the full body text, only a 3–5 sentence gist of the AI translation.
- After translation we automatically check that no untranslated Chinese text is left over. Original-script names in parentheses, such as Yu Qian (于谦), are allowed.

## 4. Briefing validation and AI review

- The daily briefing draft is written by AI using only the summaries of articles collected that day. Every item links to its source articles.
- Each draft first goes through automatic validation: every number must appear in the cited article, every cited reference must exist, and no Chinese may remain in translated text. A draft with a critical violation cannot be published.
- **A different AI model from the one that wrote the draft then reviews it.** The reviewer splits the text into individual factual claims and checks each against the cited articles (including the Chinese originals), flagging claims that are unsupported, wrong, mis-stated in number or unit, overstated, or attributed to the wrong article. It also checks for major stories of the period that were left out and whether the English and Chinese editions match the Korean one.
- Problems that can be fixed sentence by sentence are corrected using only wording found in the source articles; sentences that cannot be backed by a source are deleted. The corrected edition goes through validation and AI review again (up to two rounds).
- If the review score meets the threshold, there are no factual errors (wrong facts, number or unit errors, misattributed sources), no unsupported sentences and at most one overstatement, **the edition is published automatically without human approval.** Otherwise it stays a draft and an operator is notified, who fixes or regenerates it before publishing.
- The AI review can miss errors too. If we find an error after publication or receive a report, we replace or withdraw the edition and disclose the reason in the [corrections log](/corrections).
- Figures in the weekly and monthly reports are computed from our database, and the AI writes sentences that quote only those figures and articles. They go through the same AI review; a period with incompletely collected days is not published automatically and is published only after an operator confirms the data notice.

## 5. How we rank

"Top stories" in the list and briefing candidates are chosen by weighing the factors below together. We do not publish numeric weights, to discourage gaming.

- How many outlets covered the same story
- The outlet's expertise in AI coverage
- The article's field (technology, product, business)
- The prominence of the companies or institutions involved
- Whether the title or summary carries concrete figures
- Event and recruiting notices, columns and interviews are ranked lower

Once a briefing is published, that day's top stories in the list follow the order of the published briefing first.

## 6. Images

- Article images are the representative images published by the original outlet, shown together with a link to the original. Placeholder images such as outlet logos or avatars are not shown.
- Cover images that the original outlet generated with AI carry an **"AI-generated image"** label, which is also included in the alt text.
- Social share cards do not use original images; this site generates them with only the title, outlet and date.

## 7. Known limitations

- Machine translation can get proper nouns, industry terms and nuance wrong. Please check the original before relying on anything important.
- Figures are as reported by the outlets; this site does not independently verify them.
- With six outlets, coverage reflects the perspective and volume of Chinese media. Mention counts are not market share or performance.
- If collection fails for a time slot, fewer articles may be captured that day. The weekly report excludes such days from comparisons and says so.

If you find an error, please tell us at [{{contactEmail}}](mailto:{{contactEmail}}).
