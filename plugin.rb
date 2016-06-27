# name: discourse-osf-integration
# about: An integration plug-in for the Open Science Framework
# version: 0.0.1
# authors: Center for Open Science
enabled_site_setting :osf_integration_enabled

require 'pry'

register_asset 'stylesheets/osf-integration.scss'

register_asset 'javascripts/discourse/templates/projects/index.hbs', :server_side
register_asset 'javascripts/discourse/templates/projects/show.hbs', :server_side

after_initialize do
    PARENT_GUIDS_FIELD_NAME = "parent_guids"
    TOPIC_GUID_FIELD_NAME = "topic_guid"
    PARENT_NAMES_FIELD_NAME = "parent_names"

    module ::OsfIntegration
        class Engine < ::Rails::Engine
            engine_name "osf_integration"
            isolate_namespace OsfIntegration
        end

        def self.clean_guid(guid)
            guid.downcase.gsub(/[^a-z0-9]/, '')
        end

        def self.names_for_guids(guids)
            topics = Topic.unscoped
                            .joins("LEFT JOIN topic_custom_fields AS tc ON (topics.id = tc.topic_id)")
                            .references('tc')
                            .where('tc.name = ? AND tc.value IN (?)', TOPIC_GUID_FIELD_NAME, guids)
            guids.map do |guid|
                topic = topics.select { |t| t.topic_guid == guid }[0]
                topic ? topic.title : ''
            end
        end

        def self.parent_guids_for_guid(guid)
            topics = Topic.unscoped
                            .joins("LEFT JOIN topic_custom_fields AS tc ON (topics.id = tc.topic_id)")
                            .references('tc')
                            .where('tc.name = ? AND tc.value = ?', TOPIC_GUID_FIELD_NAME, guid)
            [topics[0].parent_guids].flatten if topics[0]
        end
    end

    # Register these custom fields so that they will allowed as parameters
    # We don't pass a block however, because we don't want to allow these guids
    # to be changed in the future.
    PostRevisor.track_topic_field(:parent_guids) do |tc, parent_guids|
        parent_guids = parent_guids.map { |guid| OsfIntegration::clean_guid(guid) }
        tc.topic.custom_fields.update(PARENT_GUIDS_FIELD_NAME => parent_guids)
    end
    PostRevisor.track_topic_field(:topic_guid)

    # Hook onto topic creation to save our custom fields
    on(:topic_created) do |topic, params, user|
      return unless user.staff?

      'SELECT topic_id
        FROM topic_allowed_groups tg
        JOIN group_users gu ON gu.user_id = :user_id AND gu.group_id = tg.group_id
        WHERE gu.group_id IN (:group_ids)'

      parent_guids = params[:parent_guids].map { |guid| OsfIntegration::clean_guid(guid) }
      topic_guid = OsfIntegration::clean_guid(params[:topic_guid])

      topic.custom_fields.update(PARENT_GUIDS_FIELD_NAME => parent_guids)
      topic.custom_fields.update(TOPIC_GUID_FIELD_NAME => topic_guid)
      topic.save
    end

    # Add methods for directly extracting these fields
    Topic.class_eval do
        def parent_guids
            [custom_fields[PARENT_GUIDS_FIELD_NAME]].flatten
        end
        def topic_guid
          custom_fields[TOPIC_GUID_FIELD_NAME]
        end
        def parent_names
            OsfIntegration::names_for_guids(parent_guids)
        end
    end

    # override slug generation
    add_to_class :topic, :slug do
      topic_guid
    end

    # Register these custom fields to be able to appear in serializer output
    TopicViewSerializer.attributes_from_topic(:parent_guids)
    TopicViewSerializer.attributes_from_topic(:topic_guid)
    TopicViewSerializer.attributes_from_topic(:parent_names)

    # Return osf related stuff in JSON output of topic items
    add_to_serializer(:topic_list_item, :parent_guids) { object.parent_guids }
    add_to_serializer(:topic_list_item, :topic_guid) { object.topic_guid }
    add_to_serializer(:topic_list_item, :parent_names) { object.parent_names }

    # Mark as preloaded so that they are always available
    if TopicList.respond_to? :preloaded_custom_fields
        TopicList.preloaded_custom_fields << PARENT_GUIDS_FIELD_NAME
        TopicList.preloaded_custom_fields << TOPIC_GUID_FIELD_NAME
        TopicList.preloaded_custom_fields << PARENT_NAMES_FIELD_NAME
    end

    # Routing for the project specific end-points
    OsfIntegration::Engine.routes.draw do
        get '/' => 'projects#index'
        constraints(project_guid: /[a-z0-9]+/) do
            get '/:project_guid' => 'projects#show'
            get '/c/:category/:project_guid' => 'projects#show'
            get '/c/:parent_category/:category/:project_guid' => 'projects#show'
            Discourse.filters.each do |filter|
              get "/:project_guid/l/#{filter}" => "projects#show_#{filter}"
              get "/c/:category/:project_guid/l/#{filter}" => "projects#show_#{filter}"
              get "/c/:parent_category/:category/:project_guid/l/#{filter}" => "projects#show_#{filter}"
            end
        end
    end

    Discourse::Application.routes.append do
      mount OsfIntegration::Engine, at: "/projects"
    end

    require_dependency 'application_controller'
    require_dependency 'topic_list_responder'
    require_dependency 'topic_query'

    # Add parent_names as an attribute to topic list and add it to the serializer
    TopicList.class_eval do
        attr_accessor :parent_guids
        attr_accessor :parent_names
    end
    TopicListSerializer.class_eval do
        attributes :parent_guids
        attributes :parent_names
    end

    TopicQuery.class_eval do
        def latest_project_results(project_guid)
            result = default_project_results(project_guid)
            remove_muted_topics(result, @user)
        end

        def unread_project_results(project_guid)
            result = default_project_results(project_guid)
            result = TopicQuery.unread_filter(result)
            suggested_ordering(result, {})
        end

        def new_project_results(project_guid)
            result = default_project_results(project_guid)
            result = TopicQuery.new_filter(result, @user.user_option.treat_as_new_topic_start_date)
            result = remove_muted_topics(result, @user)
            suggested_ordering(result, {})
        end

        def read_project_results(project_guid)
            default_project_results(project_guid).order('COALESCE(tu.last_visited_at, topics.bumped_at) DESC')
        end

        def posted_project_results(project_guid)
            default_project_results(project_guid).where('tu.posted')
        end

        def bookmarks_project_results(project_guid)
            default_project_results(project_guid).where('tu.bookmarked')
        end

        def default_project_results(project_guid)
            # Start with a list of all under the project
            result = Topic.unscoped
            result = result.joins("LEFT JOIN topic_custom_fields AS tc ON (topics.id = tc.topic_id)").references('tc')
                           .where('tc.name = ? AND tc.value = ?', PARENT_GUIDS_FIELD_NAME, project_guid)
            if @user
              result = result.joins("LEFT OUTER JOIN topic_users AS tu ON (topics.id = tu.topic_id AND tu.user_id = #{@user.id.to_i})")
                             .references('tu')
                unless @user.staff?
                    result = result.where("topics.archetype = 'regular' OR
                                                    (topics.id IN (SELECT topic_id
                                                         FROM topic_allowed_groups
                                                         WHERE group_id IN (
                                                             SELECT group_id FROM group_users WHERE user_id = #{@user.id.to_i}) AND
                                                                    group_id IN (SELECT id FROM groups WHERE name ilike ?)
                                                        ))", project_guid)
                end
            else
                result = result.where("topics.archetype = 'regular'")
            end

            # Below here is basically an exact excerpt from TopicQuery.default_results
            # The listable_topics clause is removed in favor of our own above clauses

            options = @options
            options[:visible] = true if @user.nil? || @user.regular?
            options[:visible] = false if @user && @user.id == options[:filtered_to_user]

            category_id = get_category_id(options[:category])
            @options[:category_id] = category_id
            if category_id
              if options[:no_subcategories]
                result = result.where('categories.id = ?', category_id)
              else
                result = result.where('categories.id = :category_id OR (categories.parent_category_id = :category_id AND categories.topic_id <> topics.id)', category_id: category_id)
              end
              result = result.references(:categories)
            end

            result = apply_ordering(result, options)
            #result = result.listable_topics.includes(:category)

            if options[:exclude_category_ids] && options[:exclude_category_ids].is_a?(Array) && options[:exclude_category_ids].size > 0
              result = result.where("categories.id NOT IN (?)", options[:exclude_category_ids]).references(:categories)
            end

            # Don't include the category topics if excluded
            if options[:no_definitions]
              result = result.where('COALESCE(categories.topic_id, 0) <> topics.id')
            end

            result = result.limit(options[:per_page]) unless options[:limit] == false

            result = result.visible if options[:visible]
            result = result.where.not(topics: {id: options[:except_topic_ids]}).references(:topics) if options[:except_topic_ids]

            if options[:page]
              offset = options[:page].to_i * options[:per_page]
              result = result.offset(offset) if offset > 0
            end

            if options[:topic_ids]
              result = result.where('topics.id in (?)', options[:topic_ids]).references(:topics)
            end

            if search = options[:search]
              result = result.where("topics.id in (select pp.topic_id from post_search_data pd join posts pp on pp.id = pd.post_id where pd.search_data @@ #{Search.ts_query(search.to_s)})")
            end

            # NOTE protect against SYM attack can be removed with Ruby 2.2
            #
            state = options[:state]
            if @user && state &&
                TopicUser.notification_levels.keys.map(&:to_s).include?(state)
              level = TopicUser.notification_levels[state.to_sym]
              result = result.where('topics.id IN (
                                        SELECT topic_id
                                        FROM topic_users
                                        WHERE user_id = ? AND
                                              notification_level = ?)', @user.id, level)
            end
            result

            require_deleted_clause = true
            if status = options[:status]
              case status
              when 'open'
                result = result.where('NOT topics.closed AND NOT topics.archived')
              when 'closed'
                result = result.where('topics.closed')
              when 'archived'
                result = result.where('topics.archived')
              when 'listed'
                result = result.where('topics.visible')
              when 'unlisted'
                result = result.where('NOT topics.visible')
              when 'deleted'
                guardian = @guardian
                if guardian.is_staff?
                  result = result.where('topics.deleted_at IS NOT NULL')
                  require_deleted_clause = false
                end
              end
            end

            if (filter=options[:filter]) && @user
              action =
                if filter == "bookmarked"
                  PostActionType.types[:bookmark]
                elsif filter == "liked"
                  PostActionType.types[:like]
                end
              if action
                result = result.where('topics.id IN (SELECT pp.topic_id
                                      FROM post_actions pa
                                      JOIN posts pp ON pp.id = pa.post_id
                                      WHERE pa.user_id = :user_id AND
                                            pa.post_action_type_id = :action AND
                                            pa.deleted_at IS NULL
                                   )', user_id: @user.id,
                                       action: action
                                   )
              end
            end

            result = result.where('topics.deleted_at IS NULL') if require_deleted_clause
            result = result.where('topics.posts_count <= ?', options[:max_posts]) if options[:max_posts].present?
            result = result.where('topics.posts_count >= ?', options[:min_posts]) if options[:min_posts].present?

            @guardian.filter_allowed_categories(result)
        end
    end

    class ::OsfIntegration::ProjectsController < ::ApplicationController
        include ::TopicListResponder
        requires_plugin 'discourse-osf-integration'

        PAGE_SIZE = 50

        # Tries to make sure show can be called through an XHR?
        skip_before_filter :check_xhr, only: [:show]

        def index
            render json: { projects: [''] }
        end

        # [:latest, :unread, :new, :read, :posted, :bookmarks]
        Discourse.filters.each do |filter|
            define_method("show_#{filter}") do
                project_guid = OsfIntegration::clean_guid(params[:project_guid])
                parent_guids = OsfIntegration::parent_guids_for_guid(project_guid)
                parent_names = OsfIntegration::names_for_guids(parent_guids)

                list_options = {
                    per_page: PAGE_SIZE,
                    limit: true,
                }
                list_options.merge!(build_topic_list_options)
                query = TopicQuery.new(current_user, list_options)

                result = query.send("#{filter}_project_results", project_guid)

                options = {}
                if filter == :read || filter == :unread || filter == :new
                    options = {unordered: true}
                end

                list = query.create_list(filter, options, result)
                if list.topics.size > 0
                    list.parent_guids = parent_guids
                    list.parent_names = parent_names
                end
                respond_with_list(list)
            end
        end

        def show
          show_latest
        end

        def build_topic_list_options
          options = {
            page: params[:page],
            topic_ids: param_to_integer_list(:topic_ids),
            exclude_category_ids: params[:exclude_category_ids],
            category: params[:category],
            order: params[:order],
            ascending: params[:ascending],
            min_posts: params[:min_posts],
            max_posts: params[:max_posts],
            status: params[:status],
            filter: params[:filter],
            state: params[:state],
            search: params[:search],
            q: params[:q]
          }
          options[:no_subcategories] = true if params[:no_subcategories] == 'true'
          options[:slow_platform] = true if slow_platform?

          options
        end
    end
end
