/*jshint esversion: 6*/

import Composer from 'discourse/models/composer';
import { withPluginApi } from 'discourse/lib/plugin-api';
import computed from 'ember-addons/ember-computed-decorators';
import NavigationItem from 'discourse/components/navigation-item';
import CategoryDrop from 'discourse/components/category-drop';
import DiscoveryTopicsController from 'discourse/controllers/discovery/topics';
import TopicListItem from 'discourse/components/topic-list-item';
import TopicTrackingState from 'discourse/models/topic-tracking-state';
import { on } from 'ember-addons/ember-computed-decorators';
import ComposerEditor from 'discourse/components/composer-editor';

export default {
    name: 'extend-for-projects',
    initialize() {
        // Setting this value is what makes new topics actually able to appear in the target project
        Composer.serializeOnCreate('parent_guids');

        function fixCategoryUrls() {
            var reg = new RegExp('forum\/([0-9a-z]+)');
            var match = reg.exec(window.location.toString());
            if (match) {
                var project_guid = match[1];
                var categoryLinks = document.querySelectorAll('.cat a, .category a');
                categoryLinks.forEach(function(link) {
                    if (!link.pathname.startsWith('/forum/')) {
                        link.pathname = '/forum/' + project_guid + link.pathname;
                    }
                });
            }
        }

        var api;
        withPluginApi('0.1', _api => {
            api = _api;
            api.onPageChange((url, title) => {
                fixCategoryUrls();
            });
        });

        // Make the navigation (latest, new, unread) buttons
        // more robust in determining if they are active
        NavigationItem.reopen({
            @computed("content.filterMode", "filterMode")
            active(contentFilterMode, filterMode) {
              return contentFilterMode === filterMode ||
                     contentFilterMode.indexOf(filterMode) !== -1;
            },
        });

        CategoryDrop.reopen({
            actions: {
                expand: function() {
                    this._super();
                    fixCategoryUrls();
                },
            },
        });

        // Have to make the extraction of the navigation mode more robust.
        // (basically just use navMode instead of filter)
        DiscoveryTopicsController.reopen({
            showMoreUrl(period) {
                if (this.get('model.filter').startsWith('forum')) {
                    return '/' + this.get('model.filter') + '/' + period;
                }
                let url = '', category = this.get('category');
                if (category) {
                    url = '/c/' + Discourse.Category.slugFor(category) + (this.get('noSubcategories') ? '/none' : '') + '/l';
                }
                url += '/top/' + period;
                return url;
            },

            footerMessage: function() {
                if (!this.get('allLoaded')) { return; }

                const category = this.get('category');
                if (category) {
                    return I18n.t('topics.bottom.category', { category: category.get('name') });
                } else {
                    const split = (this.get('model.navMode') || this.get('model.filter') || '').split('/');
                    if (this.get('model.topics.length') === 0) {
                        return I18n.t("topics.none." + split[0], { category: split[1] });
                    } else {
                        return I18n.t("topics.bottom." + split[0], { category: split[1] });
                    }
                }
            }.property('allLoaded', 'model.topics.length'),

            footerEducation: function() {
                if (!this.get('allLoaded') || this.get('model.topics.length') > 0 || !Discourse.User.current()) { return; }

                const split = (this.get('model.navMode') || this.get('model.filter') || '').split('/');

                if (split[0] !== 'new' && split[0] !== 'unread') { return; }

                return I18n.t("topics.none.educate." + split[0], {
                    userPrefsUrl: Discourse.getURL("/users/") + (Discourse.User.currentProp("username_lower")) + "/preferences"
                });
            }.property('allLoaded', 'model.topics.length')
        });

        TopicListItem.reopen({
            @computed()
            expandPinned() {
              return this.get('topic.excerpt');
            }
        });

        // Filter some messages by the project_guid to avoid irrelevant notifications
        TopicTrackingState.reopen({
            notify(data) {
                if ((data.message_type != 'latest' && data.message_type != 'new_topic') ||
                     data.payload.project_guid == this.project_guid) {
                    this._super();
                }
            },
        });

        var contributorSearch = function(term) {
            // Longest prefix size in common
            var charsInCommon = function(a, b) {
                var count = 0;
                for (var i = 0; i < a.length && i < b.length; i++) {
                    if (a[i].toLowerCase() == b[i].toLowerCase()) {
                        count++;
                    } else {
                        break;
                    }
                }
                return count;
            };

            var matchStrength = function(term, user) {
                return Math.max(charsInCommon(term, user.username), charsInCommon(term, user.name));
            };

            var topicModel = Discourse.__container__.lookup('controller:topic').model;
            var contributors = topicModel.contributors;
            contributors = contributors.sort((a, b) => { return matchStrength(term, b) - matchStrength(term, a); });

            var results = contributors;
            results.users = contributors.copy();
            results.groups = [];
            return results;
        };

        // Patch so that only contributors are listed for @mentions
        ComposerEditor.reopen({
            @on('didInsertElement')
            _composerEditorInit() {
                this._super();

                const template = this.container.lookup('template:user-selector-autocomplete.raw');
                const $input = this.$('.d-editor-input');
                $input.autocomplete('destroy');
                $input.autocomplete({
                    template,
                    dataSource: term => contributorSearch(term),
                    key: "@",
                    transformComplete: v => v.username || v.name
                });
            }
        });
    }
};
